/** Impact detection from the audio track of an uploaded clip: the same DSP as the live microphone path, run offline. */
import { createOnsetCore } from "@/lib/audio/onset-core";
import type { ImpactEvent } from "@/lib/audio/transient";

export interface AudioImpactOptions {
  /** real seconds per media second (1 normal, 1/8 for a clip filmed at 8x slow motion) */
  timeScale?: number;
  /** latency to subtract (ms), as in the live path */
  offsetMs?: number;
  k?: number; absMin?: number;
}

/**
 * Mix to mono and scale so the clip's peak is about 0.5. The reference is the top 0.001% of samples, not a mid percentile:
 * impacts are sparse, so a percentile near the middle sits in the background and would amplify the background to the level
 * of a bat crack. The DSP uses absolute floors, so level matters, but only relative to the clip's own loudest sound.
 */
export function normaliseAudio(ch: Float32Array[]): Float32Array {
  const n = ch[0]?.length ?? 0, mono = new Float32Array(n);
  if (!n) return mono;
  for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length;
  // log-spaced histogram of |x| over every sample, then read off the value that only 0.001% of samples exceed
  const BINS = 2048, LO = 1e-6, span = Math.log(4 / LO), hist = new Uint32Array(BINS);
  let max = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(mono[i]); if (a > max) max = a; hist[a <= LO ? 0 : Math.min(BINS - 1, Math.floor((Math.log(a / LO) / span) * BINS))]++; }
  if (max < 1e-5) return mono;
  const keep = Math.max(8, Math.floor(n * 1e-5)); let acc = 0, bin = BINS - 1;
  for (; bin > 0; bin--) { acc += hist[bin]; if (acc >= keep) break; }
  const ref = Math.min(max, LO * Math.exp(((bin + 1) / BINS) * span));
  const g = 0.5 / ref;
  for (let i = 0; i < n; i++) mono[i] *= g;
  return mono;
}

/** Find bat/pad impacts. Times are in clip time (media time x timeScale), directly comparable with the ball track. */
export function detectImpacts(channels: Float32Array[], sampleRate: number, o: AudioImpactOptions = {}): ImpactEvent[] {
  const mono = normaliseAudio(channels);
  if (!mono.length) return [];
  const scale = o.timeScale ?? 1, off = (o.offsetMs ?? 0) / 1000;
  // Prime the detector's noise floor from the clip itself. Its floor starts tiny and takes about a second to adapt, so without this
  // the first second of every clip is a false-trigger zone. A probe pass records the floor along the clip; its median is the
  // typical background, unaffected by the few impacts.
  const probe = createOnsetCore(sampleRate, { k: o.k, absMin: o.absMin }), fl: number[] = [];
  const stepF = Math.max(1, Math.round(sampleRate * 0.25));
  for (let i = 0, next = 0; i < mono.length; i += 4096) { probe.process(mono.subarray(i, Math.min(mono.length, i + 4096))); if (i >= next) { fl.push(probe.floor ?? 0); next += stepF; } }
  fl.sort((a, b) => a - b);
  const floor0 = fl.length ? Math.max(1e-4, fl[Math.floor(fl.length / 2)]) : undefined;
  const core = createOnsetCore(sampleRate, { k: o.k, absMin: o.absMin, floor0 });
  const out: ImpactEvent[] = [];
  const B = 4096;
  for (let i = 0; i < mono.length; i += B) {
    for (const e of core.process(mono.subarray(i, Math.min(mono.length, i + B)))) {
      out.push({ tPerf: (e.onsetSample / sampleRate) * scale - off, peak: e.peak, ratio: e.ratio, decayMs: e.decayMs, kind: e.kind, precisionMs: (1000 / sampleRate) * scale });
    }
  }
  return out;
}
