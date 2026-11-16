/**
 * Delivery segmentation shared by the live camera and by clip upload: feeds frames to the ball detector and tracker,
 * decides when a delivery starts and when it is over. Pure (no DOM), so it runs in Node tests on synthetic frames.
 */
import type { ZoomPan } from "@/lib/cv/stabilise";
import type { CameraModel } from "@/lib/types";
import { pixelToGround } from "@/lib/physics/homography";
import { BallDetector, BallTracker, type Gray, type TrackPoint } from "@/lib/cv/ball-detector";

export interface DeliveryTrackerOptions {
  /** a delivery begins once the tracker has this many points */
  minPoints?: number;
  /** end the delivery this long after the ball is lost (s) */
  lostAfterS?: number;
  /** end the delivery this long after an audio impact (s) */
  afterImpactS?: number;
  /** hard cap on delivery length (s) */
  maxS?: number;
  /** tracks slower than this over the ground (m/s) are people, not a ball in flight */
  minGroundSpeed?: number;
  /** ball detector frame-difference threshold */
  threshold?: number;
}

/** RMS distance (px) of points from the best quadratic-in-time curve through them: near zero for a ball in flight. */
export function quadResidual(pts: TrackPoint[]): number {
  const n = pts.length; if (n < 4) return 0;
  const t0 = pts[0].t, ts = pts.map((p) => p.t - t0);
  const tm = ts.reduce((q, v) => q + v, 0) / n, tc = ts.map((v) => v - tm);
  const fit = (vs: number[]) => {
    // least squares v = a + b t + c t^2 (centred t), normal equations solved by elimination
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < n; i++) { const r = [1, tc[i], tc[i] * tc[i]]; for (let j = 0; j < 3; j++) { for (let k = 0; k < 3; k++) M[j][k] += r[j] * r[k]; M[j][3] += r[j] * vs[i]; } }
    for (let c = 0; c < 3; c++) {
      let piv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-15) return 0;
      for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
    }
    const co = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
    let e = 0; for (let i = 0; i < n; i++) { const r = vs[i] - (co[0] + co[1] * tc[i] + co[2] * tc[i] * tc[i]); e += r * r; }
    return e;
  };
  return Math.sqrt((fit(pts.map((p) => p.x)) + fit(pts.map((p) => p.y))) / n);
}

/** The longest run of consecutive points (at least `minLen`) whose quadratic residual stays under `tol`. */
export function smoothestRun(pts: TrackPoint[], tol: number, minLen: number): TrackPoint[] | null {
  let best: TrackPoint[] | null = null;
  for (let a = 0; a + minLen <= pts.length; a++) {
    let b = a + minLen;
    if (quadResidual(pts.slice(a, b)) >= tol) continue;
    while (b < pts.length && quadResidual(pts.slice(a, b + 1)) < tol) b++;
    if (!best || b - a > best.length) best = pts.slice(a, b);
  }
  return best;
}

export class DeliveryTracker {
  readonly detector: BallDetector;
  tracker = new BallTracker();
  /** more trackers on the candidates the main one did not use: a ball can fly while the main one is stuck on a limb, and
   *  there are often several people moving (bowler, batter, umpire) */
  pool: BallTracker[] = Array.from({ length: 5 }, () => new BallTracker());
  private poolSnap: TrackPoint[][] = this.pool.map(() => []);
  /** smooth track pieces any tracker followed (offline analysis fits each one and keeps those that pass as ball flights) */
  hypotheses: TrackPoint[][] = [];
  private keepHypothesis(pts: TrackPoint[], w: number) {
    const run = smoothestRun(pts, 0.002 * w, 5);
    if (run) this.hypotheses.push(run);
  }
  swaps = 0;
  track: TrackPoint[] = [];
  inDelivery = false;
  tStart = 0;
  private lastPt = 0;
  private times: number[] = [];
  private lastGray: Gray | null = null;
  frames = 0; dupes = 0; busy = 0;
  /** share of frames whose noise floor was so high that a ball could not be seen: a moving or zooming camera, or very heavy compression */
  get busyShare() { return this.frames ? this.busy / this.frames : 0; }
  private o: Required<Omit<DeliveryTrackerOptions, "threshold">>;

  slowDropped = 0;
  private fastSeen = false;
  constructor(private cam: CameraModel, readonly scale: number, opts: DeliveryTrackerOptions = {}) {
    this.detector = new BallDetector(cam, scale, opts.threshold);
    this.o = { minPoints: opts.minPoints ?? 4, lostAfterS: opts.lostAfterS ?? 0.5, afterImpactS: opts.afterImpactS ?? 1.0, maxS: opts.maxS ?? 3, minGroundSpeed: opts.minGroundSpeed ?? 11 };
  }

  /** Process one downscaled grayscale frame. `fps` is the (estimated) frame rate used to convert optical flow to px/s. */
  /** `toRef` (zooming/panning cameras): maps this frame's analysis coordinates into the calibration frame's; points come back in those. */
  step(t: number, gray: Gray, fps: number, toRef?: ZoomPan): TrackPoint | null {
    // Frame-rate conversion leaves bit-identical copies of the previous frame. A copy zeroes the three-frame difference and the
    // ball disappears, so drop copies: the timestamps of the frames that remain simply have gaps, which the tracker handles.
    const prev = this.lastGray;
    this.lastGray = gray;
    this.frames++;
    if (prev && prev.w === gray.w && prev.h === gray.h) {
      let changed = 0; const a = gray.data, b = prev.data;
      for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; if (d > 1 || d < -1) { if (++changed > 2) break; } }
      if (changed <= 2) { this.dupes++; return null; }
    }
    const base = Math.max(1, Math.min(4, Math.round(fps / 80)));
    this.lastW = gray.w;
    const cands = this.detector.detect(gray, base, toRef);
    if (this.detector.lastThreshold > 60) this.busy++;
    // the detector reports on the middle frame of its three-frame window, `base` frames back
    this.times.push(t); if (this.times.length > base + 1) this.times.shift();
    if (this.times.length < base + 1) return null;
    t = this.times[0];
    const p0 = this.tracker.step(t, cands, fps, gray.w);
    let rest = p0 ? cands.filter((c) => Math.hypot(c.x - p0.x, c.y - p0.y) > 2) : cands;
    this.pool.forEach((tr, i) => {
      const q = tr.step(t, rest, fps, gray.w);
      if (q) rest = rest.filter((c) => Math.hypot(c.x - q.x, c.y - q.y) > 2);
      // a pool tracker stuck on a person (a jerky path) is released, so it is free to start clean on the next smooth object
      if (tr.points.length >= 8 && quadResidual(tr.points.slice(-8)) > 0.004 * gray.w) tr.reset();
      // a track that ended (lost or released) is kept as a hypothesis if part of it was a smooth flight
      if (tr.points.length < this.poolSnap[i].length) this.keepHypothesis(this.poolSnap[i], gray.w);
      this.poolSnap[i] = tr.points.slice();
    });
    const p = p0;
    if (p) {
      // a track seeded from three frames hands back its earlier points too
      const pts = this.tracker.points;
      if (this.track.length === 0 && pts.length > 1) this.track.push(...pts.slice(0, -1));
      this.track.push(p); this.lastPt = t;
      if (!this.inDelivery && this.track.length >= this.o.minPoints) {
        // a ball in flight covers the ground at 15+ m/s; a running bowler, a fielder or the batter's bat at well under that.
        // Measure the track's speed over the ground (points dropped onto the pitch plane) and refuse slow ones.
        const g = this.track.map((q) => pixelToGround(this.cam, { x: q.x / this.scale, y: q.y / this.scale }));
        const a = this.track[0], b = this.track[this.track.length - 1], ga = g[0], gb = g[g.length - 1];
        const v = Math.hypot(gb.x - ga.x, gb.y - ga.y) / Math.max(1e-3, b.t - a.t);
        const smooth = this.track.length >= 6 && quadResidual(this.track.slice(-8)) < 0.002 * gray.w;
        if (v < this.o.minGroundSpeed && !smooth) { this.tracker.reset(); this.track = []; this.slowDropped++; return null; }
        this.inDelivery = true; this.tStart = this.track[0].t; this.fastSeen = v >= this.o.minGroundSpeed || smooth;
      } else if (this.inDelivery && this.track.length >= 8) {
        // keep checking: a track that has never reached ball speed and is crawling now is a person, not a delivery
        const n = this.track.length, q0 = this.track[n - 8], q1 = this.track[n - 1];
        const g0 = pixelToGround(this.cam, { x: q0.x / this.scale, y: q0.y / this.scale }), g1 = pixelToGround(this.cam, { x: q1.x / this.scale, y: q1.y / this.scale });
        const v = Math.hypot(g1.x - g0.x, g1.y - g0.y) / Math.max(1e-3, q1.t - q0.t);
        if (v >= this.o.minGroundSpeed) this.fastSeen = true;
        else if (!this.fastSeen) { this.take(); this.slowDropped++; return null; }
      }
    }
    return p;
  }

  /** True when the current delivery should be closed at time `t`; `lastImpactT` is the latest audio impact (clip time) or undefined. */
  shouldFinalize(t: number, lastImpactT?: number): boolean {
    if (!this.inDelivery) return false;
    return (!this.tracker.active && t - this.lastPt > this.o.lostAfterS) || (lastImpactT !== undefined && t - lastImpactT > this.o.afterImpactS) || t - this.tStart > this.o.maxS;
  }

  /** Last time the ball was seen. */
  get tLast() { return this.lastPt; }

  /** Take the finished track (in downscaled pixels) and reset for the next delivery. */
  take(): TrackPoint[] {
    const tr = this.track;
    this.track = []; this.inDelivery = false; this.tracker.reset();
    return tr;
  }

  reset() { this.take(); this.flushHypotheses(); this.detector.reset(); this.times = []; }
  private lastW = 640;
  /** Close every pool track (end of clip or a camera cut), keeping their smooth pieces as hypotheses. */
  flushHypotheses() { this.pool.forEach((tr, i) => { this.keepHypothesis(this.poolSnap[i], this.lastW); tr.reset(); this.poolSnap[i] = []; }); }
}
