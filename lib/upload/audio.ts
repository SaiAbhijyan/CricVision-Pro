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

/** Mix to mono and scale so the 99.5th-percentile level is 0.3: clips differ hugely in loudness and the DSP uses absolute floors. */
export function normaliseAudio(ch: Float32Array[]): Float32Array {
  const n = ch[0]?.length ?? 0, mono = new Float32Array(n);
  if (!n) return mono;
  for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i] / ch.length;
  const stride = Math.max(1, Math.floor(n / 50000)), mags: number[] = [];
  for (let i = 0; i < n; i += stride) mags.push(Math.abs(mono[i]));
  mags.sort((a, b) => a - b);
  const ref = mags[Math.floor(mags.length * 0.995)] || 0;
  if (ref < 1e-5) return mono;
  const g = 0.3 / ref;
  for (let i = 0; i < n; i++) mono[i] *= g;
  return mono;
}

/** Find bat/pad impacts. Times are in clip time (media time x timeScale), directly comparable with the ball track. */
export function detectImpacts(channels: Float32Array[], sampleRate: number, o: AudioImpactOptions = {}): ImpactEvent[] {
  const mono = normaliseAudio(channels);
  if (!mono.length) return [];
  const scale = o.timeScale ?? 1, off = (o.offsetMs ?? 0) / 1000;
  const core = createOnsetCore(sampleRate, { k: o.k, absMin: o.absMin });
  const out: ImpactEvent[] = [];
  const B = 4096;
  for (let i = 0; i < mono.length; i += B) {
    for (const e of core.process(mono.subarray(i, Math.min(mono.length, i + B)))) {
      out.push({ tPerf: (e.onsetSample / sampleRate) * scale - off, peak: e.peak, ratio: e.ratio, decayMs: e.decayMs, kind: e.kind, precisionMs: (1000 / sampleRate) * scale });
    }
  }
  return out;
}
