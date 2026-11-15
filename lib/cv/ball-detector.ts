import type { CameraModel, Pt } from "@/lib/types";
import { expectedBallPx, pitchCorridor, pointInPolygon, pixelToGround } from "@/lib/physics/homography";
import { BallKalman } from "./kalman";

/** Grayscale frame (downscaled) used by all CV stages. */
export interface Gray { w: number; h: number; data: Uint8ClampedArray }

export function toGray(img: ImageData): Gray {
  const { width: w, height: h, data } = img;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return { w, h, data: g };
}

export interface Candidate { x: number; y: number; area: number; flow: { vx: number; vy: number } | null }

/**
 * Lucas–Kanade optical flow at one point (single-scale, window half-size `r`).
 * Returns pixel displacement between prev and cur (px/frame), or null if ill-conditioned.
 */
export function lucasKanade(prev: Gray, cur: Gray, cx: number, cy: number, r = 4): { dx: number; dy: number } | null {
  const { w, h } = prev;
  let sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0;
  const x0 = Math.max(1, Math.round(cx) - r), x1 = Math.min(w - 2, Math.round(cx) + r);
  const y0 = Math.max(1, Math.round(cy) - r), y1 = Math.min(h - 2, Math.round(cy) + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const ix = (prev.data[i + 1] - prev.data[i - 1]) * 0.5;
      const iy = (prev.data[i + w] - prev.data[i - w]) * 0.5;
      const it = cur.data[i] - prev.data[i];
      sxx += ix * ix; sxy += ix * iy; syy += iy * iy; sxt += ix * it; syt += iy * it;
    }
  }
  const det = sxx * syy - sxy * sxy;
  if (det < 1e-3 * (sxx + syy + 1) ) return null;
  return { dx: -(syy * sxt - sxy * syt) / det, dy: -(sxx * syt - sxy * sxt) / det };
}

/**
 * Moving-ball detector:
 *  - triple-frame differencing (|I_t - I_{t-1}| ∧ |I_t - I_{t-2}|) isolates fast, small movers
 *  - connected components restricted to the pitch corridor ROI
 *  - blob size gated against the expected ball diameter from the homography (7.15 cm)
 */
export class BallDetector {
  private corridor: Pt[] = [];
  private mask: Uint8Array | null = null;
  private maskW = 0;
  private maskH = 0;

  /** threshold: a fixed gray-level step, or "auto" (default) = 3x the 99th percentile of the frame-difference noise, never below `floor` */
  constructor(private cam: CameraModel, private scale: number, private threshold: number | "auto" = "auto", private floor = 10) {
    this.rebuildMask();
  }
  /** last threshold used (diagnostics) */
  lastThreshold = 0;

  setCamera(cam: CameraModel) { this.cam = cam; this.rebuildMask(); }

  private rebuildMask() {
    this.corridor = pitchCorridor(this.cam).map((p) => ({ x: p.x * this.scale, y: p.y * this.scale }));
    this.mask = null;
  }

  private ensureMask(w: number, h: number) {
    if (this.mask && this.maskW === w && this.maskH === h) return;
    const m = new Uint8Array(w * h);
    if (this.corridor.length >= 3) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pointInPolygon({ x, y }, this.corridor)) m[y * w + x] = 1;
    }
    this.mask = m; this.maskW = w; this.maskH = h;
  }

  /**
   * Process one frame; returns ball candidates for the PREVIOUS frame (one frame of latency), in downscaled image coordinates.
   * Symmetric three-frame difference: a pixel counts only if the middle frame differs from both its predecessor and its
   * successor, which removes the "ghost" a slow ball leaves where it sat in two earlier frames.
   */
  detect(cur: Gray, base = 1): Candidate[] {
    this.ensureMask(cur.w, cur.h);
    const { w, h } = cur;
    const out: Candidate[] = [];
    // frame ring: the window is (prev, mid, next) = (cur - 2*base, cur - base, cur). A wider baseline keeps a slow-moving ball
    // from cancelling itself against its own earlier position (high frame-rate clips move the ball only a few px per frame).
    this.ring.push(cur); if (this.ring.length > 2 * base + 1) this.ring.splice(0, this.ring.length - (2 * base + 1));
    if (this.ring.length < 2 * base + 1 || this.ring[0].w !== w || this.ring[0].h !== h) return out;
    const a = this.ring[base], b = this.ring[0];
    const bin = new Uint8Array(w * h);
    const mv = new Uint8Array(w * h);     // min of the two frame differences: the ball must differ from BOTH previous frames
    const mask = this.mask!;
    const hist = new Uint32Array(256); let nSamp = 0;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const d1 = Math.abs(a.data[i] - b.data[i]), d2 = Math.abs(a.data[i] - cur.data[i]);   // a = middle frame, b = previous, cur = next
      const m = d1 < d2 ? d1 : d2;
      mv[i] = m;
      if ((i & 3) === 0) { hist[m]++; nSamp++; }
    }
    let th: number;
    if (this.threshold === "auto") {
      let acc = 0, p99 = 0; const target = nSamp * 0.99;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { p99 = v; break; } }
      th = Math.max(this.floor, this.autoK * p99);
    } else th = this.threshold;
    this.lastThreshold = th;
    for (let i = 0; i < w * h; i++) if (mv[i] > th) bin[i] = 1;
    // connected components (4-neighbour, iterative flood fill)
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || seen[i]) continue;
      let area = 0, sx = 0, sy = 0, sw = 0, minx = w, maxx = 0, miny = h, maxy = 0;
      stack.length = 0; stack.push(i); seen[i] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % w, y = (k / w) | 0;
        area++; const wt = mv[k]; sx += x * wt; sy += y * wt; sw += wt;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (area > 2000) break;
        if (x > 0 && bin[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
        if (x < w - 1 && bin[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
        if (y > 0 && bin[k - w] && !seen[k - w]) { seen[k - w] = 1; stack.push(k - w); }
        if (y < h - 1 && bin[k + w] && !seen[k + w]) { seen[k + w] = 1; stack.push(k + w); }
      }
      if (area < 1 || area > 400 || sw <= 0) continue;
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (aspect > 4) continue; // a ball (even motion-smeared) is compact; limbs/bats are long
      const cx = sx / sw + 0.5, cy = sy / sw + 0.5;   // pixel centres -> continuous image coordinates
      // size gate using the homography: estimate ground point under the blob, expected ball px at ~1m height
      const g = pixelToGround(this.cam, { x: cx / this.scale, y: cy / this.scale });
      const expPx = expectedBallPx(this.cam, g.x, Math.min(Math.max(g.y, 0), 20.12), 1.0) * this.scale;
      const diam = Math.max(bw, bh);
      if (expPx > 0 && diam > expPx * 4 + 6) continue;
      const lk = area >= 6 ? lucasKanade(b, a, cx, cy, 4) : null;
      out.push({ x: cx, y: cy, area, flow: lk ? { vx: lk.dx, vy: lk.dy } : null });
    }
    return out;
  }

  /** noise multiplier for the auto threshold (th = autoK x 99th percentile of the min frame-difference) */
  autoK = 2.4;

  private ring: Gray[] = [];

  reset() { this.ring = []; }
}

export interface TrackPoint { t: number; x: number; y: number }

/** Multi-frame ball tracker: Kalman-gated nearest-candidate association, seeded from optical flow or from three frames of consistent motion. */
export class BallTracker {
  private kf: BallKalman | null = null;
  private lastSeen = 0;
  points: TrackPoint[] = [];
  private misses = 0;
  private recent: { t: number; c: Candidate[] }[] = [];

  /** `maxPxPerFrame`: fastest plausible ball motion between frames (analysis pixels) when seeding from candidates alone */
  constructor(private maxMisses = 6, private gate = 25, private maxPxPerFrame = 0.25) {}

  get active() { return this.kf !== null; }
  get predicted(): Pt | null { return this.kf ? this.kf.pos : null; }

  /** `t` in seconds; `fps` used to convert LK px/frame to px/s. `frameW` (analysis width) bounds seed speed. */
  step(t: number, cands: Candidate[], fps: number, frameW = 480): TrackPoint | null {
    if (this.kf) {
      this.kf.predict(t);
      // among gated candidates prefer the larger blob: a ball that overlaps its own earlier positions leaves small "ghost" remnants
      // there, and the nearest-candidate rule would lock onto them and drag the track backwards
      let best: Candidate | null = null, bs = Infinity;
      for (const c of cands) {
        const d = this.kf.gate(c.x, c.y);
        if (d >= this.gate) continue;
        const sc = (d + 1) / (1 + Math.sqrt(c.area));
        if (sc < bs) { bs = sc; best = c; }
      }
      if (best) {
        this.kf.update(best.x, best.y, best.flow ? { vx: best.flow.vx * fps, vy: best.flow.vy * fps } : null);
        this.misses = 0; this.lastSeen = t;
        // record the measurement itself: the constant-velocity filter lags a ball that accelerates in the image (perspective), the detection does not
        const p = { t, x: best.x, y: best.y };
        this.points.push(p);
        return p;
      }
      this.misses++;
      if (this.misses > this.maxMisses) { this.kf = null; }
      return null;
    }
    // 1. a candidate with a clear optical-flow velocity starts a track at once
    const seed = cands.filter((c) => c.flow && Math.hypot(c.flow.vx, c.flow.vy) > 1.5).sort((a, b) => b.area - a.area)[0];
    if (seed && seed.flow) {
      this.kf = new BallKalman(seed.x, seed.y, t, seed.flow.vx * fps, seed.flow.vy * fps);
      this.points = [{ t, x: seed.x, y: seed.y }];
      this.misses = 0; this.lastSeen = t; this.recent = [];
      return this.points[0];
    }
    // 2. small balls give no usable flow: look for three detections (not necessarily consecutive frames) on one constant-velocity path
    this.recent.push({ t, c: cands.slice().sort((p, q) => q.area - p.area).slice(0, 10) }); if (this.recent.length > 6) this.recent.shift();
    const R = this.recent, n = R.length, vmax = this.maxPxPerFrame * frameW;
    if (n >= 3) {
      let best: { a: Candidate; b: Candidate; c: Candidate; ta: number; tb: number; tc: number; score: number } | null = null;
      const k = n - 1;   // the newest frame must be part of the triple, so a track starts as soon as it exists
      for (let i = 0; i < k - 1; i++) for (let j = i + 1; j < k; j++) {
        const dtA = R[j].t - R[i].t, dtB = R[k].t - R[j].t; if (dtA <= 0 || dtB <= 0) continue;
        for (const a of R[i].c) for (const b of R[j].c) {
          const dA = Math.hypot(b.x - a.x, b.y - a.y);
          if (dA < 1.2 * (j - i) || dA > vmax * (j - i)) continue;
          for (const c of R[k].c) {
            const px = b.x + ((b.x - a.x) * dtB) / dtA, py = b.y + ((b.y - a.y) * dtB) / dtA;
            const err = Math.hypot(c.x - px, c.y - py), tol = 1.5 + 0.18 * dA * (dtB / dtA);
            if (err > tol) continue;
            const score = err / tol - 0.05 * Math.log(1 + a.area + b.area + c.area);
            if (!best || score < best.score) best = { a, b, c, ta: R[i].t, tb: R[j].t, tc: R[k].t, score };
          }
        }
      }
      if (best) {
        const { a, b, c, ta, tb, tc } = best;
        this.kf = new BallKalman(c.x, c.y, tc, (c.x - b.x) / (tc - tb), (c.y - b.y) / (tc - tb));
        this.points = [{ t: ta, x: a.x, y: a.y }, { t: tb, x: b.x, y: b.y }, { t: tc, x: c.x, y: c.y }];
        this.misses = 0; this.lastSeen = t; this.recent = [];
        return this.points[this.points.length - 1];
      }
    }
    return null;
  }

  reset() { this.kf = null; this.points = []; this.misses = 0; this.recent = []; }
}
