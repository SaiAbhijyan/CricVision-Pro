/**
 * Delivery segmentation shared by the live camera and by clip upload: feeds frames to the ball detector and tracker,
 * decides when a delivery starts and when it is over. Pure (no DOM), so it runs in Node tests on synthetic frames.
 */
import type { CameraModel } from "@/lib/types";
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
  /** ball detector frame-difference threshold */
  threshold?: number;
}

export class DeliveryTracker {
  readonly detector: BallDetector;
  readonly tracker = new BallTracker();
  track: TrackPoint[] = [];
  inDelivery = false;
  tStart = 0;
  private lastPt = 0;
  private times: number[] = [];
  private o: Required<Omit<DeliveryTrackerOptions, "threshold">>;

  constructor(cam: CameraModel, readonly scale: number, opts: DeliveryTrackerOptions = {}) {
    this.detector = new BallDetector(cam, scale, opts.threshold);
    this.o = { minPoints: opts.minPoints ?? 4, lostAfterS: opts.lostAfterS ?? 0.5, afterImpactS: opts.afterImpactS ?? 1.0, maxS: opts.maxS ?? 3 };
  }

  /** Process one downscaled grayscale frame. `fps` is the (estimated) frame rate used to convert optical flow to px/s. */
  step(t: number, gray: Gray, fps: number): TrackPoint | null {
    const base = Math.max(1, Math.min(4, Math.round(fps / 80)));
    const cands = this.detector.detect(gray, base);
    // the detector reports on the middle frame of its three-frame window, `base` frames back
    this.times.push(t); if (this.times.length > base + 1) this.times.shift();
    if (this.times.length < base + 1) return null;
    t = this.times[0];
    const p = this.tracker.step(t, cands, fps, gray.w);
    if (p) {
      // a track seeded from three frames hands back its earlier points too
      const pts = this.tracker.points;
      if (this.track.length === 0 && pts.length > 1) this.track.push(...pts.slice(0, -1));
      this.track.push(p); this.lastPt = t;
      if (!this.inDelivery && this.track.length >= this.o.minPoints) { this.inDelivery = true; this.tStart = this.track[0].t; }
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

  reset() { this.take(); this.detector.reset(); this.times = []; }
}
