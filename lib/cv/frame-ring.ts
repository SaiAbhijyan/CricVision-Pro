/**
 * Fixed-capacity circular buffer of timestamped frames (seconds, performance.now domain).
 * Holds the last N seconds of video so an impact detected later can pull the frames around it (±2 ms alignment).
 */
export interface RingFrame<T> { t: number; item: T }

export class FrameRing<T> {
  private buf: (RingFrame<T> | undefined)[];
  private head = 0;   // next write slot
  private size = 0;

  constructor(readonly capacity: number, private onEvict?: (f: RingFrame<T>) => void) {
    this.buf = new Array(capacity);
  }

  /** Capacity for `seconds` of video at `fps` with headroom. */
  static forSeconds(seconds: number, fps: number) { return Math.ceil(seconds * fps * 1.1); }

  get length() { return this.size; }

  push(t: number, item: T) {
    const old = this.buf[this.head];
    if (old && this.size === this.capacity) this.onEvict?.(old);
    this.buf[this.head] = { t, item };
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /** i = 0 is the oldest frame. */
  at(i: number): RingFrame<T> | undefined {
    if (i < 0 || i >= this.size) return undefined;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    return this.buf[(start + i) % this.capacity];
  }

  oldest() { return this.at(0); }
  newest() { return this.at(this.size - 1); }

  /** Index of the frame closest in time to `t` (binary search; frames are time-ordered). */
  nearestIndex(t: number): number {
    if (!this.size) return -1;
    let lo = 0, hi = this.size - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.at(m)!.t < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(this.at(lo - 1)!.t - t) <= Math.abs(this.at(lo)!.t - t)) lo--;
    return lo;
  }
  nearest(t: number) { const i = this.nearestIndex(t); return i < 0 ? undefined : this.at(i); }

  /** Frames with t0 <= t <= t1, oldest first. */
  range(t0: number, t1: number): RingFrame<T>[] {
    const out: RingFrame<T>[] = [];
    for (let i = 0; i < this.size; i++) { const f = this.at(i)!; if (f.t >= t0 && f.t <= t1) out.push(f); }
    return out;
  }

  /** Mean inter-frame interval in seconds (0 if <2 frames). */
  meanDt() {
    if (this.size < 2) return 0;
    return (this.newest()!.t - this.oldest()!.t) / (this.size - 1);
  }

  clear() {
    if (this.onEvict) for (let i = 0; i < this.size; i++) this.onEvict(this.at(i)!);
    this.buf = new Array(this.capacity); this.head = 0; this.size = 0;
  }
}
