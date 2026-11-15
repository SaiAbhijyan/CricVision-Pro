/**
 * Renders a synthetic video clip of a known delivery: the ball is a sub-pixel antialiased disc with motion blur on a
 * noisy background, projected through a real camera model. Because the truth is known, the analysis pipeline's errors
 * (speed, pitching point, swing) can be measured. This validates the detector, tracker and 3-D fit, not real-world accuracy.
 */
import type { CameraModel, Vec3 } from "../../lib/types";
import { project, expectedBallPx } from "../../lib/physics/homography";
import { simulateDelivery, type DeliverySpec } from "../../lib/physics/ballistics";
import type { Gray } from "../../lib/cv/ball-detector";
import type { ClipFrame, ClipSource } from "../../lib/upload/analyse";
import { SMALL_W } from "../../lib/upload/analyse";

export function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const gauss = (r: () => number) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export interface SynthOptions {
  cam: CameraModel; spec: DeliverySpec; hand?: "RHB" | "LHB";
  fps: number;
  /** pixel noise std-dev (gray levels) */ noise?: number;
  /** background gray under the ball path: pitch ~118, grass ~88, dark screen ~35 */ bg?: number;
  /** ball gray: red ball on pitch ~75, white ball ~240 */ ball?: number;
  /** exposure as a fraction of the frame interval (motion-blur length) */ shutter?: number;
  /** add a moving "bowler" distractor */ distractor?: boolean;
  /** seconds of footage before release and after the ball reaches the stumps */ lead?: number; tail?: number;
  seed?: number;
  /** analysis width (px); the live path uses 480, uploads 960 */ width?: number;
  /** vertical texture: stumps, creases, grass stripes (gray amplitude) */ texture?: number;
}

export interface SynthClip { src: ClipSource; truth: { release: Vec3; speedKph: number; bounce: Vec3 | null; flightT: number; tRelease: number; tStumps: number; flight: ReturnType<typeof simulateDelivery> } }

export function renderClip(o: SynthOptions): SynthClip {
  const flight = simulateDelivery(o.spec, o.hand ?? "RHB");
  const lead = o.lead ?? 0.5, tail = o.tail ?? 0.5;
  const tFlight = flight.samples[flight.samples.length - 1].t;
  const dur = lead + tFlight + tail, fps = o.fps, n = Math.round(dur * fps);
  const AW = o.width ?? SMALL_W, scale = AW / o.cam.imageWidth, W = AW, H = Math.round(o.cam.imageHeight * scale);
  const rand = rng(o.seed ?? 1);
  const bg = o.bg ?? 118, ballG = o.ball ?? 75, shutter = o.shutter ?? 0.5, noise = o.noise ?? 3, tex = o.texture ?? 6;
  const posAt = (t: number): Vec3 | null => {
    const tt = t - lead; if (tt < 0 || tt > tFlight) return null;
    const s = flight.samples; let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].t <= tt) lo = m; else hi = m; }
    const a = s[lo], b = s[hi], f = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0;
    return { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, z: a.p.z + (b.p.z - a.p.z) * f };
  };
  // static background texture (stripes), fixed per clip
  const base = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) base[y * W + x] = bg + tex * Math.sin(x * 0.21 + y * 0.13) + tex * 0.6 * Math.sin(y * 0.9);
  const drawDisc = (img: Float32Array, cx: number, cy: number, r: number, val: number, wgt: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(W - 1, Math.ceil(cx + r + 1)), y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); const cov = Math.min(1, Math.max(0, r + 0.5 - d));
      if (cov > 0) img[y * W + x] += (val - img[y * W + x]) * cov * wgt;
    }
  };
  const frame = async (k: number): Promise<ClipFrame> => {
    const t = k / fps;
    const img = Float32Array.from(base);
    if (o.distractor) { // bowler: a 14x40 px body running toward the batter, a swinging arm
      const u = Math.min(1, Math.max(0, (t - lead + 0.8) / 1.4));
      const g = o.cam; const p = project(g, { x: -0.7, y: 1 + 8 * u - 6, z: 0.9 });
      if (p) { const cx = p.x * scale, cy = p.y * scale; for (let y = -14; y <= 14; y++) for (let x = -3; x <= 3; x++) { const X = Math.round(cx + x), Y = Math.round(cy + y); if (X >= 0 && X < W && Y >= 0 && Y < H) img[Y * W + X] = 200; } }
    }
    // ball: integrate coverage over the exposure with 5 sub-samples
    const sub = 5, tExp = shutter / fps;
    for (let s = 0; s < sub; s++) {
      const ts = t - tExp / 2 + (tExp * (s + 0.5)) / sub, p = posAt(ts);
      if (!p) continue;
      const px = project(o.cam, p); if (!px) continue;
      const r = Math.max(0.6, (expectedBallPx(o.cam, p.x, Math.min(Math.max(p.y, 0), 20.12), p.z) * scale) / 2);
      drawDisc(img, px.x * scale, px.y * scale, r, ballG, 1 / sub * 1.0 + 0);
    }
    const data = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) data[i] = img[i] + noise * gauss(rand);
    return { t, gray: { w: W, h: H, data } as Gray };
  };
  const src: ClipSource = { analysisWidth: AW, width: o.cam.imageWidth, height: o.cam.imageHeight, fps, frameCount: n, frame: (k) => frame(k) };
  return { src, truth: { release: o.spec.release, speedKph: o.spec.speedMs * 3.6, bounce: flight.bounce?.p ?? null, flightT: tFlight, tRelease: lead, tStumps: lead + tFlight, flight } };
}
