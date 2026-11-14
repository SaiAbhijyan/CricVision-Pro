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
  private f1: Gray | null = null;
  private f2: Gray | null = null;
  private corridor: Pt[] = [];
  private mask: Uint8Array | null = null;
  private maskW = 0;
  private maskH = 0;

  constructor(private cam: CameraModel, private scale: number, private threshold = 28) {
    this.rebuildMask();
  }

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

  /** Process one frame; returns ball candidates (positions in the downscaled image coordinates). */
  detect(cur: Gray): Candidate[] {
    this.ensureMask(cur.w, cur.h);
    const { w, h } = cur;
    const out: Candidate[] = [];
    const a = this.f1, b = this.f2;
    if (!a || !b || a.w !== w || a.h !== h) { this.f2 = this.f1; this.f1 = cur; return out; }
    const bin = new Uint8Array(w * h);
    const mask = this.mask!;
    const th = this.threshold;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const d1 = Math.abs(cur.data[i] - a.data[i]);
      const d2 = Math.abs(cur.data[i] - b.data[i]);
      if (d1 > th && d2 > th) bin[i] = 1;
    }
    // connected components (4-neighbour, iterative flood fill)
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || seen[i]) continue;
      let area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
      stack.length = 0; stack.push(i); seen[i] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % w, y = (k / w) | 0;
        area++; sx += x; sy += y;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (area > 2000) break;
        if (x > 0 && bin[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
        if (x < w - 1 && bin[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
        if (y > 0 && bin[k - w] && !seen[k - w]) { seen[k - w] = 1; stack.push(k - w); }
        if (y < h - 1 && bin[k + w] && !seen[k + w]) { seen[k + w] = 1; stack.push(k + w); }
      }
      if (area < 2 || area > 400) continue;
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (aspect > 4) continue; // a ball (even motion-smeared) is compact; limbs/bats are long
      const cx = sx / area, cy = sy / area;
      // size gate using the homography: estimate ground point under the blob, expected ball px at ~1m height
      const g = pixelToGround(this.cam, { x: cx / this.scale, y: cy / this.scale });
      const expPx = expectedBallPx(this.cam, g.x, Math.min(Math.max(g.y, 0), 20.12), 1.0) * this.scale;
      const diam = Math.max(bw, bh);
      if (expPx > 0 && (diam > expPx * 4 + 6 || diam < expPx * 0.25)) continue;
      const lk = lucasKanade(a, cur, cx, cy, 4);
      out.push({ x: cx, y: cy, area, flow: lk ? { vx: lk.dx, vy: lk.dy } : null });
    }
    this.f2 = this.f1; this.f1 = cur;
    return out;
  }

  reset() { this.f1 = null; this.f2 = null; }
}

export interface TrackPoint { t: number; x: number; y: number }

/** Multi-frame ball tracker: Kalman-gated nearest-candidate association with optical-flow velocity updates. */
export class BallTracker {
  private kf: BallKalman | null = null;
  private lastSeen = 0;
  points: TrackPoint[] = [];
  private misses = 0;

  constructor(private maxMisses = 6, private gate = 25) {}

  get active() { return this.kf !== null; }
  get predicted(): Pt | null { return this.kf ? this.kf.pos : null; }

  /** `t` in seconds; `fps` used to convert LK px/frame to px/s. */
  step(t: number, cands: Candidate[], fps: number): TrackPoint | null {
    if (this.kf) {
      this.kf.predict(t);
      let best: Candidate | null = null, bd = this.gate;
      for (const c of cands) {
        const d = this.kf.gate(c.x, c.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        this.kf.update(best.x, best.y, best.flow ? { vx: best.flow.vx * fps, vy: best.flow.vy * fps } : null);
        this.misses = 0; this.lastSeen = t;
        const p = { t, x: this.kf.x[0], y: this.kf.x[1] };
        this.points.push(p);
        return p;
      }
      this.misses++;
      if (this.misses > this.maxMisses) { this.kf = null; }
      return null;
    }
    // initiate a track from the strongest candidate with flow
    const seed = cands.filter((c) => c.flow && Math.hypot(c.flow.vx, c.flow.vy) > 1.5).sort((a, b) => b.area - a.area)[0];
    if (seed && seed.flow) {
      this.kf = new BallKalman(seed.x, seed.y, t, seed.flow.vx * fps, seed.flow.vy * fps);
      this.points = [{ t, x: seed.x, y: seed.y }];
      this.misses = 0; this.lastSeen = t;
      return this.points[0];
    }
    return null;
  }

  reset() { this.kf = null; this.points = []; this.misses = 0; }
}
