/**
 * Impact-transient DSP, written as plain-JS *source text* so the exact same code runs
 *   (a) inside an AudioWorkletProcessor (sample-accurate timing, ~0.02 ms resolution) and
 *   (b) in Node for the self-check (new Function).
 *
 * Pipeline per sample:  x -> HP 2 kHz -> LP 5 kHz = band;  env = |band|;  low = LP 800 Hz(x)
 *   noise floor  : slow EMA of env while idle
 *   trigger      : env > max(absMin, k * floor)  (and outside the refractory window)
 *   onset sample : walk back through a 96-sample env history to the first sample above 2 * floor
 *   features     : over the next 20 ms -> peak, band energy, low energy, decay time to 20 % of peak
 *   classify     : sharp + high-frequency dominant = bat (sweet if loud, edge if quiet); otherwise pad/body
 */
export const ONSET_CORE_SOURCE = `
class OnsetCore {
  constructor(sr, o) {
    o = o || {};
    this.sr = sr; this.k = o.k || 8; this.absMin = o.absMin || 0.012; this.refr = Math.round((o.refractoryMs || 80) * sr / 1000);
    this.win = Math.round(0.02 * sr);
    this.hp = this._bq('hp', 2000, 0.707); this.lp = this._bq('lp', 5000, 0.707); this.lo = this._bq('lp', 800, 0.707);
    this.floor = 0.001; this.floorA = 1 - Math.exp(-1 / (0.5 * sr));
    this.hist = new Float32Array(96); this.hi = 0;
    this.n = 0; this.state = 0; this.cool = 0; this.ev = null;
  }
  _bq(type, f, q) {
    const w = 2 * Math.PI * f / this.sr, c = Math.cos(w), a = Math.sin(w) / (2 * q), a0 = 1 + a;
    const b0 = type === 'hp' ? (1 + c) / 2 : (1 - c) / 2, b1 = type === 'hp' ? -(1 + c) : 1 - c;
    return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: -2 * c / a0, a2: (1 - a) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  _run(f, x) {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y; return y;
  }
  /** Feed a block; returns completed events [{onsetSample, peak, ratio, decayMs, kind}] (sample indices are absolute). */
  process(block) {
    const out = [];
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      const band = this._run(this.lp, this._run(this.hp, x));
      const low = this._run(this.lo, x);
      const env = Math.abs(band);
      this.hist[this.hi] = env; this.hi = (this.hi + 1) % 96;
      if (this.state === 0) {
        this.floor += this.floorA * (env - this.floor);
        if (this.cool > 0) this.cool--;
        else if (env > Math.max(this.absMin, this.k * this.floor)) {
          let j = 0, idx = (this.hi - 1 + 96) % 96;
          while (j < 95 && this.hist[idx] > 2 * this.floor) { j++; idx = (idx - 1 + 96) % 96; }
          this.ev = { onset: this.n - j, count: 0, peak: 0, peakAt: 0, band: 0, low: 0, below: -1 };
          this.state = 1;
        }
      }
      if (this.state === 1) {
        const e = this.ev; e.count++; e.band += band * band; e.low += low * low;
        if (env > e.peak) { e.peak = env; e.peakAt = e.count; e.below = -1; }
        else if (e.below < 0 && env < 0.2 * e.peak) e.below = e.count;
        if (e.count >= this.win) {
          const decayN = (e.below < 0 ? e.count : e.below) - e.peakAt;
          const decayMs = Math.max(0, decayN) * 1000 / this.sr;
          const ratio = e.band / (e.low + 1e-9);
          const sharp = decayMs < 10 && ratio > 0.8;
          out.push({ onsetSample: e.onset, peak: e.peak, ratio: ratio, decayMs: decayMs, kind: sharp ? (e.peak > 0.12 ? 'bat-sweet' : 'bat-edge') : 'pad-body' });
          this.state = 0; this.cool = this.refr; this.ev = null;
        }
      }
      this.n++;
    }
    return out;
  }
}
`;

export type ImpactKind = "bat-sweet" | "bat-edge" | "pad-body";
export interface OnsetEvent { onsetSample: number; peak: number; ratio: number; decayMs: number; kind: ImpactKind }
export interface OnsetCoreLike { process(block: Float32Array): OnsetEvent[] }

/** Instantiate the core outside a worklet (Node self-check, main-thread fallback). */
export function createOnsetCore(sampleRate: number, opts?: { k?: number; absMin?: number; refractoryMs?: number }): OnsetCoreLike {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${ONSET_CORE_SOURCE}; return new OnsetCore(${sampleRate}, ${JSON.stringify(opts ?? {})});`)() as OnsetCoreLike;
}
