import { ONSET_CORE_SOURCE, createOnsetCore, type ImpactKind, type OnsetEvent } from "./onset-core";

export interface ImpactEvent {
  /** Impact time in the performance.now() domain, seconds — directly comparable with video frame timestamps. */
  tPerf: number;
  peak: number; ratio: number; decayMs: number; kind: ImpactKind;
  /** Timing resolution of this detector path in ms (worklet ≈ 0.05, analyser fallback ≈ 12). */
  precisionMs: number;
}

const WORKLET_SOURCE = `${ONSET_CORE_SOURCE}
class ImpactProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.core = new OnsetCore(sampleRate); this.frame = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      const evs = this.core.process(ch);
      for (const e of evs) this.port.postMessage({ e: e, ctxTime: e.onsetSample / sampleRate, now: currentTime });
    }
    return true;
  }
}
registerProcessor('impact-processor', ImpactProcessor);`;

/**
 * Mic -> [HP 2 kHz -> LP 5 kHz -> AnalyserNode (level meter)]  and  mic -> AudioWorklet (onset DSP).
 * The worklet reports the *sample-exact* onset in AudioContext time; `getOutputTimestamp()` maps that into
 * performance.now() so it can be matched against requestVideoFrameCallback timestamps.
 * `offsetMs` is the user-calibrated mic latency (SessionConfig.audioOffsetMs).
 */
export class ImpactDetector {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private node: AudioWorkletNode | null = null;
  private timeBuf: Float32Array<ArrayBuffer> | null = null;
  private poll = 0;
  private fallbackCore = createOnsetCore(48000);
  private lastFallback = 0;
  precisionMs = 0.05;
  onImpact: (e: ImpactEvent) => void = () => {};
  /** 0..1 live level of the 2–5 kHz band for the UI meter. */
  level = 0;

  constructor(public offsetMs = 0) {}

  async start(): Promise<{ sampleRate: number; mode: "worklet" | "analyser" }> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2000; hp.Q.value = 0.707;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000; lp.Q.value = 0.707;
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0;
    src.connect(hp); hp.connect(lp); lp.connect(this.analyser);
    this.timeBuf = new Float32Array(this.analyser.fftSize);
    const sr = this.ctx.sampleRate;

    let mode: "worklet" | "analyser" = "analyser";
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, "impact-processor");
      this.node.port.onmessage = (m) => {
        const { e, ctxTime } = m.data as { e: OnsetEvent; ctxTime: number };
        this.emit(e, ctxTime, 0.05);
      };
      src.connect(this.node);
      mode = "worklet";
    } catch {
      this.precisionMs = 12;
      this.fallbackCore = createOnsetCore(sr);
    }
    this.poll = requestAnimationFrame(this.tick);
    return { sampleRate: sr, mode };
  }

  private emit(e: OnsetEvent, ctxTime: number, precisionMs: number) {
    if (!this.ctx) return;
    const ts = this.ctx.getOutputTimestamp();
    const perfNow = ts.performanceTime ?? performance.now();
    const ctxNow = ts.contextTime ?? this.ctx.currentTime;
    const tPerf = (perfNow + (ctxTime - ctxNow) * 1000 - this.offsetMs) / 1000;
    this.onImpact({ tPerf, peak: e.peak, ratio: e.ratio, decayMs: e.decayMs, kind: e.kind, precisionMs });
  }

  private tick = () => {
    if (!this.analyser || !this.timeBuf || !this.ctx) return;
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let s = 0; for (let i = 0; i < this.timeBuf.length; i++) s += this.timeBuf[i] * this.timeBuf[i];
    this.level = Math.min(1, Math.sqrt(s / this.timeBuf.length) * 12);
    if (!this.node) {
      // fallback: run the onset core over the (already band-passed) analyser window — coarse timing only
      const now = this.ctx.currentTime;
      const evs = this.fallbackCore.process(this.timeBuf);
      for (const e of evs) if (now - this.lastFallback > 0.08) { this.lastFallback = now; this.emit(e, now - (this.timeBuf.length - e.onsetSample) / this.ctx.sampleRate, this.precisionMs); }
    }
    this.poll = requestAnimationFrame(this.tick);
  };

  /** Re-calibrate: clap in view of the camera, click in the UI, call with the observed video-vs-audio gap. */
  setOffsetMs(ms: number) { this.offsetMs = ms; }

  stop() {
    cancelAnimationFrame(this.poll);
    this.node?.disconnect(); this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null; this.node = null; this.analyser = null; this.stream = null;
  }
}

/**
 * Pick the video frame an impact belongs to. Returns the index of the frame whose timestamp is nearest to the impact,
 * plus the residual in ms (should be ≤ half a frame interval — 4 ms at 120 fps, ±2 ms after sub-frame interpolation of the ball track).
 */
export function matchImpactToFrame(frameTimes: number[], tImpact: number): { index: number; residualMs: number } {
  let best = -1, bd = Infinity;
  for (let i = 0; i < frameTimes.length; i++) { const d = Math.abs(frameTimes[i] - tImpact); if (d < bd) { bd = d; best = i; } }
  return { index: best, residualMs: best < 0 ? Infinity : (frameTimes[best] - tImpact) * 1000 };
}
