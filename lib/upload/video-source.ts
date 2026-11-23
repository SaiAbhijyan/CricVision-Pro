/** Browser-side ClipSource: decodes an uploaded video by stepping an HTMLVideoElement frame by frame. Nothing leaves the device. */
import type { ClipFrame, ClipSource } from "./analyse";
import type { CameraModel } from "@/lib/types";
import type { PoseTracker } from "@/lib/cv/pose";
import type { FrameRing } from "@/lib/cv/frame-ring";
import type { PosePair } from "@/lib/cv/pose";
import { ANALYSIS_WIDTH, chooseAnalysisWidth, effectiveFps, estimateFps, frameClipTime, frameSeekTime, rgbaToGray } from "./media";
import { detectImpacts } from "./audio";
import type { ImpactEvent } from "@/lib/audio/transient";
import { CutDetector, shotsFromCuts, type Shot } from "./shots";

export interface VideoSourceOptions {
  video: HTMLVideoElement;
  mediaFps: number;
  /** real seconds per media second */
  timeScale: number;
  pose?: PoseTracker | null;
  /** receives a downscaled copy of about 30 frames per second of clip time, for the highlight clip */
  ring?: FrameRing<ImageBitmap> | null;
  ringWidth?: number;
}

const seekTo = (v: HTMLVideoElement, t: number) => new Promise<void>((resolve, reject) => {
  if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) { resolve(); return; }
  const ok = () => { cleanup(); resolve(); };
  const bad = () => { cleanup(); reject(new Error("The video could not be read at that point.")); };
  const cleanup = () => { v.removeEventListener("seeked", ok); v.removeEventListener("error", bad); clearTimeout(timer); };
  const timer = setTimeout(() => { cleanup(); reject(new Error("The video took too long to seek. Try a shorter clip or an MP4 encoded as H.264.")); }, 15000);
  v.addEventListener("seeked", ok); v.addEventListener("error", bad);
  v.currentTime = t;
});

export class VideoClipSource implements ClipSource {
  readonly width: number; readonly height: number; readonly analysisWidth: number; readonly fps: number; readonly frameCount: number;
  private canvas: OffscreenCanvas | HTMLCanvasElement; private g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private ringCanvas: OffscreenCanvas | null = null; private ringStride: number; private lastRingK = -1e9;
  private aw: number; private ah: number;

  constructor(private o: VideoSourceOptions) {
    const v = o.video;
    this.width = v.videoWidth; this.height = v.videoHeight;
    this.analysisWidth = chooseAnalysisWidth(v.videoWidth);
    this.aw = this.analysisWidth; this.ah = Math.round((v.videoHeight * this.aw) / v.videoWidth);
    this.fps = effectiveFps(o.mediaFps, o.timeScale);
    this.frameCount = Math.max(0, Math.floor(v.duration * o.mediaFps));
    const oc = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(this.aw, this.ah) : Object.assign(document.createElement("canvas"), { width: this.aw, height: this.ah });
    this.canvas = oc; this.g = oc.getContext("2d", { willReadFrequently: true }) as typeof this.g;
    this.ringStride = Math.max(1, Math.round(this.fps / 30));
    if (o.ring && typeof OffscreenCanvas !== "undefined") {
      const rw = o.ringWidth ?? 480; this.ringCanvas = new OffscreenCanvas(rw, Math.round((v.videoHeight * rw) / v.videoWidth));
    }
  }

  newShot() { this.o.pose?.newShot(); }

  /** Full-colour frame k: the video element itself, seeked there (callers draw it straight away). */
  async image(k: number) {
    const v = this.o.video;
    await seekTo(v, frameSeekTime(k, this.o.mediaFps));
    return { img: v as CanvasImageSource, w: v.videoWidth, h: v.videoHeight, t: frameClipTime(k, this.o.mediaFps, this.o.timeScale) };
  }

  async frame(k: number, opt: { pose: boolean; poseCam?: CameraModel }): Promise<ClipFrame> {
    const v = this.o.video;
    await seekTo(v, frameSeekTime(k, this.o.mediaFps));
    const t = frameClipTime(k, this.o.mediaFps, this.o.timeScale);
    this.g.drawImage(v, 0, 0, this.aw, this.ah);
    const px = this.g.getImageData(0, 0, this.aw, this.ah).data;
    const gray = { w: this.aw, h: this.ah, data: rgbaToGray(px, this.aw, this.ah) };
    if (this.o.ring && this.ringCanvas && k - this.lastRingK >= this.ringStride) {
      this.lastRingK = k;
      const rg = this.ringCanvas.getContext("2d")!; rg.drawImage(v, 0, 0, this.ringCanvas.width, this.ringCanvas.height);
      this.o.ring.push(t, await createImageBitmap(this.ringCanvas));
    }
    let pose: PosePair | undefined;
    if (opt.poseCam && this.o.pose) this.o.pose.setCamera(opt.poseCam);
    if (opt.pose && this.o.pose) { try { pose = this.o.pose.detect(v, t); } catch { pose = undefined; } }
    return { t, gray, pose };
  }
}

/** Estimate the media frame rate by playing the first moments and reading frame timestamps (null if the browser cannot say). */
export async function probeFps(v: HTMLVideoElement): Promise<number | null> {
  const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number };
  if (!vv.requestVideoFrameCallback) return null;
  const times: number[] = [];
  const was = v.currentTime, mute = v.muted; v.muted = true;
  try {
    await v.play();
    await new Promise<void>((resolve) => {
      const step = (_n: number, m: { mediaTime: number }) => { times.push(m.mediaTime); if (times.length >= 24 || v.ended) resolve(); else vv.requestVideoFrameCallback!(step); };
      vv.requestVideoFrameCallback!(step);
      setTimeout(resolve, 2500);
    });
  } catch { /* autoplay refused: fall back to the manual choice */ } finally { v.pause(); v.muted = mute; v.currentTime = was; }
  return estimateFps(times);
}

/** Decode the audio track and find bat and pad impacts (offline version of the live microphone path). */
export async function audioImpacts(file: File, timeScale: number, signal?: { aborted: boolean }): Promise<{ impacts: ImpactEvent[]; hasAudio: boolean }> {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return { impacts: [], hasAudio: false };
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    if (signal?.aborted) return { impacts: [], hasAudio: true };
    const ch: Float32Array[] = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
    return { impacts: detectImpacts(ch, buf.sampleRate, { timeScale }), hasAudio: true };
  } catch { return { impacts: [], hasAudio: false }; }
  finally { void ctx.close(); }
}

export { ANALYSIS_WIDTH };

/** Quick pass over a video (5 samples a second, 160x90) to find its camera shots, for highlight reels and broadcast clips. Media time. */
export async function scanShots(v: HTMLVideoElement, signal: { aborted: boolean }, onProgress?: (frac: number) => void, hz = 5): Promise<Shot[]> {
  const W = 160, H = 90, c = new OffscreenCanvas(W, H), g = c.getContext("2d", { willReadFrequently: true })!;
  const cd = new CutDetector(0.4), dur = v.duration;
  for (let t = 0; t < dur && !signal.aborted; t += 1 / hz) {
    v.currentTime = t;
    await new Promise<void>((res) => { const done = () => { v.removeEventListener("seeked", done); res(); }; v.addEventListener("seeked", done); setTimeout(done, 3000); });
    g.drawImage(v, 0, 0, W, H);
    cd.push(t, { w: W, h: H, data: rgbaToGray(g.getImageData(0, 0, W, H).data, W, H) });
    onProgress?.(t / dur);
  }
  return shotsFromCuts(cd.cuts, dur);
}
