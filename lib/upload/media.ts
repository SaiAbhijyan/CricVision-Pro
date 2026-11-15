/** Pure helpers for uploaded clips (no DOM), so they run in the Node test suite. */

/** Largest file the browser analyser accepts. The file never leaves the device; the limit protects memory, not a server. */
export const MAX_UPLOAD_BYTES = 1_500_000_000;
export const MAX_CLIP_SECONDS = 600;
const EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;

export interface FileLike { name: string; size: number; type: string }

/** Returns a plain-language reason the file cannot be analysed, or null if it can. */
export function validateUpload(f: FileLike): string | null {
  if (!f || typeof f.name !== "string") return "No file was chosen.";
  if (f.size <= 0) return "That file is empty.";
  if (f.size > MAX_UPLOAD_BYTES) return `That file is ${(f.size / 1e9).toFixed(1)} GB. The limit is ${(MAX_UPLOAD_BYTES / 1e9).toFixed(1)} GB; trim the clip to the deliveries you want analysed.`;
  const typeOk = /^video\//.test(f.type), extOk = EXT.test(f.name);
  if (!typeOk && !extOk) return "That does not look like a video. Use an MP4, MOV, M4V or WebM clip.";
  if (typeOk && !extOk && !/^video\/(mp4|quicktime|webm|x-matroska|x-m4v)$/.test(f.type)) return `Videos of type ${f.type.slice(0, 40)} are not supported. Use an MP4, MOV or WebM clip.`;
  return null;
}

export interface SlowMo { label: string; timeScale: number }
/** Slow-motion factors: a clip filmed at 240 fps and played at 30 fps is "8x" (media seconds are 8x longer than real seconds). */
export const SLOW_MO: SlowMo[] = [
  { label: "Normal speed", timeScale: 1 },
  { label: "2x slow motion", timeScale: 1 / 2 },
  { label: "4x slow motion", timeScale: 1 / 4 },
  { label: "8x slow motion", timeScale: 1 / 8 },
];

/** Real-time frames per second after the slow-motion factor. */
export const effectiveFps = (mediaFps: number, timeScale: number) => mediaFps / timeScale;

/** Clip time (real seconds) of frame k. */
export const frameClipTime = (k: number, mediaFps: number, timeScale: number) => (k / mediaFps) * timeScale;

/** Media time (seconds) at the middle of frame k: seeking to the exact frame boundary can land on the previous frame. */
export const frameSeekTime = (k: number, mediaFps: number) => (k + 0.5) / mediaFps;

/** Frame index nearest to a media time. */
export const frameAtMediaTime = (t: number, mediaFps: number) => Math.max(0, Math.round(t * mediaFps - 0.5));

/** Media-time to clip-time conversion (real seconds). */
export const clipTime = (mediaT: number, timeScale: number) => mediaT * timeScale;

const COMMON_FPS = [24, 25, 30, 48, 50, 60, 100, 120, 240, 480];
/** snap a measured rate to the nearest standard rate when it is within 3% (29.97 -> 30, 59.94 -> 60) */
export const snapFps = (fps: number) => COMMON_FPS.find((c) => Math.abs(c - fps) / c < 0.03) ?? Math.round(fps * 100) / 100;

/**
 * Estimate the media frame rate from presentation timestamps (seconds). Uses the median gap, which ignores dropped
 * frames and decoder hiccups, then snaps to a standard rate when it is within 3%.
 */
export function estimateFps(mediaTimes: number[]): number | null {
  const t = mediaTimes.filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g > 1e-4) gaps.push(g); }
  if (gaps.length < 3) return null;
  gaps.sort((a, b) => a - b);
  const fps = 1 / gaps[Math.floor(gaps.length / 2)];
  const snap = COMMON_FPS.find((c) => Math.abs(c - fps) / c < 0.03);
  return snap ?? Math.round(fps * 100) / 100;
}

/** RGBA to 8-bit luma, resampled to the analysis size by area-averaging a source already drawn at that size. */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return out;
}

/** Analysis width: the ball is a few pixels across, so use 960 px (the width the validation harness measures); never upscale. */
export const ANALYSIS_WIDTH = 960;
export const chooseAnalysisWidth = (videoWidth: number) => Math.max(320, Math.min(videoWidth, ANALYSIS_WIDTH));

/** Rough analysis time (s) so the UI can say what to expect. About 25 ms per frame plus a few seconds per fit. */
export function estimateAnalysisSeconds(frames: number): number { return Math.round(frames * 0.025 + 5); }
