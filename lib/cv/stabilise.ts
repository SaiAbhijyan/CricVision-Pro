/**
 * Camera-motion compensation for broadcast footage. Broadcast cameras zoom and pan through the run-up and the delivery, which
 * breaks frame differencing (everything moves) and a fixed pitch calibration. Each frame-to-frame motion is modelled as a zoom
 * about the image centre plus a pan, estimated from the picture by coarse-to-fine search, then every frame is warped into the
 * coordinates of one reference frame (the one the pitch was calibrated on): downstream the camera is still.
 */
import type { Gray } from "./ball-detector";

/** maps a point in frame A to frame B: x_B = s*(x_A - cx) + cx + tx (same for y) */
export interface ZoomPan { s: number; tx: number; ty: number }
export const IDENTITY: ZoomPan = { s: 1, tx: 0, ty: 0 };

export const applyZP = (m: ZoomPan, w: number, h: number, x: number, y: number) => ({ x: m.s * (x - w / 2) + w / 2 + m.tx, y: m.s * (y - h / 2) + h / 2 + m.ty });
/** a then b */
export const composeZP = (a: ZoomPan, b: ZoomPan): ZoomPan => ({ s: a.s * b.s, tx: b.s * a.tx + b.tx, ty: b.s * a.ty + b.ty });
export const invertZP = (m: ZoomPan): ZoomPan => ({ s: 1 / m.s, tx: -m.tx / m.s, ty: -m.ty / m.s });

function box3(g: Gray): Gray {
  const { w, h } = g, d = new Uint8ClampedArray(w * h), src = g.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; sum += src[yy * w + xx]; n++; } }
    d[y * w + x] = sum / n;
  }
  return { w, h, data: d };
}

function down(g: Gray): Gray {
  const w = g.w >> 1, h = g.h >> 1, d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * g.w + 2 * x; d[y * w + x] = (g.data[i] + g.data[i + 1] + g.data[i + g.w] + g.data[i + g.w + 1]) >> 2; }
  return { w, h, data: d };
}

/** mean |B(m(x)) - A(x)| over a sparse grid, skipping the bottom `skipBottom` share (score bars and captions stay put on screen) */
function cost(A: Gray, B: Gray, m: ZoomPan, skipBottom: number, step: number) {
  const { w, h } = A, hMax = Math.floor(h * (1 - skipBottom));
  let sum = 0, n = 0;
  for (let y = 2; y < hMax - 2; y += step) for (let x = 2; x < w - 2; x += step) {
    const bx = m.s * (x - w / 2) + w / 2 + m.tx, by = m.s * (y - h / 2) + h / 2 + m.ty;
    if (bx < 0 || by < 0 || bx >= w - 1 || by >= hMax - 1) continue;
    const x0 = bx | 0, y0 = by | 0, fx = bx - x0, fy = by - y0, i = y0 * w + x0;
    const v = (B.data[i] * (1 - fx) + B.data[i + 1] * fx) * (1 - fy) + (B.data[i + w] * (1 - fx) + B.data[i + w + 1] * fx) * fy;
    sum += Math.abs(v - A.data[y * w + x]); n++;
  }
  return n > 50 ? sum / n : Infinity;
}

/** Zoom and pan from frame A to frame B. `err` is the remaining mean absolute difference (gray levels). */
export function estimateZoomPan(A: Gray, B: Gray, opts: { skipBottom?: number; maxZoom?: number; maxPanFrac?: number; guess?: ZoomPan } = {}): ZoomPan & { err: number } {
  const skip = opts.skipBottom ?? 0.15, maxZ = opts.maxZoom ?? 0.06, maxP = opts.maxPanFrac ?? 0.06;
  // Pre-smooth the finest level: bilinear interpolation averages neighbouring pixels, which cancels part of the sensor noise, so
  // an unsmoothed cost prefers a small false shift or zoom (measured: 0.15% zoom per frame on a still camera). Smoothed images
  // carry little noise left for interpolation to remove, and the bias goes away.
  const pa: Gray[] = [box3(A)], pb: Gray[] = [box3(B)];
  while (pa[pa.length - 1].w > 120) { pa.push(down(pa[pa.length - 1])); pb.push(down(pb[pb.length - 1])); }
  const L = pa.length - 1, f = 2 ** L;
  const g0: ZoomPan = opts.guess ? { s: opts.guess.s, tx: opts.guess.tx / f, ty: opts.guess.ty / f } : { ...IDENTITY };
  let best = g0;
  // exhaustive at the coarsest level, centred on the guess (a fast zoom is predicted well by the previous frame's motion)
  const a = pa[L], b = pb[L], R = Math.ceil(maxP * a.w);
  let bc = cost(a, b, best, skip, 1);
  for (let s = g0.s * (1 - maxZ); s <= g0.s * (1 + maxZ) + 1e-9; s += 0.005 * g0.s) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const m = { s, tx: Math.round(g0.tx) + dx, ty: Math.round(g0.ty) + dy };
    const c = cost(a, b, m, skip, 2); if (c < bc) { bc = c; best = m; }
  }
  // refine down the pyramid: local pattern search
  for (let l = L; l >= 0; l--) {
    if (l < L) best = { s: best.s, tx: best.tx * 2, ty: best.ty * 2 };
    const A2 = pa[l], B2 = pb[l], step = 1;
    let c = cost(A2, B2, best, skip, step);
    // finest level: search down to 1/32 px and 0.0001 zoom; chained over hundreds of frames, coarser steps add up to drift
    const stop = l === 0 ? 0.03 : 0.12;
    for (let ds = 0.004, dt = 1; dt >= stop; ds /= 2, dt /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const [k, d] of [["s", ds], ["s", -ds], ["tx", dt], ["tx", -dt], ["ty", dt], ["ty", -dt]] as const) {
          const m = { ...best, [k]: best[k] + d }, cc = cost(A2, B2, m, skip, step);
          if (cc < c - 1e-6) { c = cc; best = m; improved = true; }
        }
      }
    }
    if (l === 0) return { ...best, err: c };
  }
  return { ...best, err: Infinity };
}

/** Warp `src` so that a point at x in src lands at m(x) in the output; uncovered pixels come from `fill` (or stay 0). */
export function warpGray(src: Gray, m: ZoomPan, fill?: Gray): Gray {
  const { w, h } = src, out = new Uint8ClampedArray(w * h), inv = invertZP(m);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = inv.s * (x - w / 2) + w / 2 + inv.tx, sy = inv.s * (y - h / 2) + h / 2 + inv.ty;
    if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) { out[y * w + x] = fill ? fill.data[y * w + x] : 0; continue; }
    const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * w + x] = (src.data[i] * (1 - fx) + src.data[i + 1] * fx) * (1 - fy) + (src.data[i + w] * (1 - fx) + src.data[i + w + 1] * fx) * fy;
  }
  return { w, h, data: out };
}
