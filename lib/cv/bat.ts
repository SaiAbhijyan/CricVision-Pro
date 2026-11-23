import type { Pt } from "@/lib/types";

/**
 * Bat tracking as a two-point rigid skeleton (handle, toe), from an oriented-box detector (YOLOv8-OBB trained on cricket bats).
 * The long axis of the box is the bat; the end nearer the batter's hands is the handle. Everything here is image-plane
 * geometry: the bat's angle and sweep are exact in the picture, while speeds are scaled by the bat's own length in pixels,
 * so they hold when the swing plane faces the camera and shrink when it turns away (the report labels them estimates).
 */
export interface BatPose { t: number; handle: Pt; toe: Pt; conf: number; lenPx: number }
export interface ObbBox { cx: number; cy: number; w: number; h: number; angle: number; conf: number }

/** Standard senior bat length (handle top to toe), metres. Laws allow up to 96.5 cm; most adult bats are 84-86 cm. */
export const BAT_LENGTH_M = 0.85;

/** Decode a YOLOv8-OBB output tensor laid out [1, 4 + nc + 1, N] (cx, cy, w, h, class scores..., angle in radians). */
export function decodeObb(data: Float32Array | number[], n: number, nc = 1, minConf = 0.25, max = 5): ObbBox[] {
  const out: ObbBox[] = [];
  const row = (r: number, i: number) => data[r * n + i];
  for (let i = 0; i < n; i++) {
    let conf = 0;
    for (let c = 0; c < nc; c++) conf = Math.max(conf, row(4 + c, i));
    if (conf < minConf) continue;
    out.push({ cx: row(0, i), cy: row(1, i), w: row(2, i), h: row(3, i), angle: row(4 + nc, i), conf });
  }
  out.sort((a, b) => b.conf - a.conf);
  // rotated boxes of one bat overlap heavily: suppress any box whose centre lies within half the bat's length of a kept one
  const kept: ObbBox[] = [];
  for (const b of out) {
    if (kept.some((k) => Math.hypot(k.cx - b.cx, k.cy - b.cy) < 0.5 * Math.max(k.w, k.h))) continue;
    kept.push(b);
    if (kept.length >= max) break;
  }
  return kept;
}

/** The two ends of a box's long axis. */
export function obbEnds(b: ObbBox): [Pt, Pt] {
  const long = b.w >= b.h ? b.w : b.h, a = b.w >= b.h ? b.angle : b.angle + Math.PI / 2;
  const dx = (Math.cos(a) * long) / 2, dy = (Math.sin(a) * long) / 2;
  return [{ x: b.cx - dx, y: b.cy - dy }, { x: b.cx + dx, y: b.cy + dy }];
}

/** Pick the batter's bat and orient it: the end nearer the hands is the handle. Without hands, the higher end (bats are held
 *  above the toe at stance and through most of the swing). A box far from the hands is someone else's bat or a false hit. */
export function batFromBoxes(boxes: ObbBox[], t: number, hands: Pt | null): BatPose | null {
  let best: { b: ObbBox; ends: [Pt, Pt]; d: number } | null = null;
  for (const b of boxes) {
    const ends = obbEnds(b), len = Math.max(b.w, b.h);
    if (len < 12) continue;
    const d = hands ? Math.min(Math.hypot(ends[0].x - hands.x, ends[0].y - hands.y), Math.hypot(ends[1].x - hands.x, ends[1].y - hands.y)) : 0;
    if (hands && d > 0.6 * len) continue;
    if (!best || b.conf - d / (4 * len) > best.b.conf - best.d / (4 * Math.max(best.b.w, best.b.h))) best = { b, ends, d };
  }
  if (!best) return null;
  const [e0, e1] = best.ends;
  const e0Handle = hands ? Math.hypot(e0.x - hands.x, e0.y - hands.y) <= Math.hypot(e1.x - hands.x, e1.y - hands.y) : e0.y <= e1.y;
  return { t, handle: e0Handle ? e0 : e1, toe: e0Handle ? e1 : e0, conf: best.b.conf, lenPx: Math.max(best.b.w, best.b.h) };
}

export interface BatSwing {
  /** bat angle from vertical at contact in the picture: 0 = straight bat, 90 = flat (horizontal) bat */
  batAngleAtContactDeg: number;
  /** highest the toe got above the handle before the downswing, as an angle above horizontal (90 = toe straight up) */
  batLiftDeg: number;
  /** peak angular speed of the bat in the picture, deg/s */
  peakAngularDegS: number;
  /** toe speed near contact, from pixels scaled by the bat's own length: an estimate */
  toeSpeedKph: number;
  /** how much of the window the bat was found in, 0..1 */
  coverage: number;
  frames: number;
}

const angOf = (p: BatPose) => Math.atan2(p.toe.x - p.handle.x, p.toe.y - p.handle.y);   // 0 = toe straight down
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Swing metrics from a bat track around one contact. `expected` is how many frames were analysed (for coverage). */
export function batSwing(track: BatPose[], impactT: number, expected: number): BatSwing | null {
  const tr = track.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (tr.length < 5) return null;
  // a bat that jumps (another object, a flipped handle/toe) breaks the rigid-skeleton assumption: drop isolated outliers
  const good: BatPose[] = [];
  for (let i = 0; i < tr.length; i++) {
    const p = tr[i], q = good[good.length - 1];
    if (q && p.t > q.t) {
      const w = Math.abs(wrap(angOf(p) - angOf(q))) / (p.t - q.t);
      if (w > (3000 * Math.PI) / 180) continue;   // faster than 3000 deg/s in the picture: not the same bat
    }
    good.push(p);
  }
  if (good.length < 5) return null;
  const at = good.reduce((b, p) => (Math.abs(p.t - impactT) < Math.abs(b.t - impactT) ? p : b), good[0]);
  if (Math.abs(at.t - impactT) > 0.08) return null;   // no bat seen near contact
  const deg = (r: number) => (r * 180) / Math.PI;
  let lift = -90, peakW = 0, toeV = 0;
  for (let i = 0; i < good.length; i++) {
    const p = good[i];
    if (p.t <= impactT) lift = Math.max(lift, deg(Math.atan2(p.handle.y - p.toe.y, Math.abs(p.toe.x - p.handle.x))));
    if (i > 0) {
      const q = good[i - 1], dt = p.t - q.t;
      if (dt <= 0) continue;
      peakW = Math.max(peakW, Math.abs(deg(wrap(angOf(p) - angOf(q)))) / dt);
      if (Math.abs(p.t - impactT) <= 0.07) {
        const mPerPx = BAT_LENGTH_M / ((p.lenPx + q.lenPx) / 2);
        toeV = Math.max(toeV, (Math.hypot(p.toe.x - q.toe.x, p.toe.y - q.toe.y) * mPerPx) / dt);
      }
    }
  }
  return {
    batAngleAtContactDeg: Math.round(Math.min(Math.abs(deg(angOf(at))), 180 - Math.abs(deg(angOf(at)))) * 10) / 10,   // vertical either way up
    batLiftDeg: Math.round(lift),
    peakAngularDegS: Math.round(peakW),
    toeSpeedKph: Math.round(toeV * 3.6 * 10) / 10,
    coverage: Math.round(Math.min(1, good.length / Math.max(1, expected)) * 100) / 100,
    frames: good.length,
  };
}

/** Letterbox geometry used for the model input (and to map boxes back to the frame). */
export function letterbox(W: number, H: number, S: number) {
  const r = Math.min(S / W, S / H), nw = Math.round(W * r), nh = Math.round(H * r);
  return { r, nw, nh, px: Math.floor((S - nw) / 2), py: Math.floor((S - nh) / 2) };
}

type OrtModule = typeof import("onnxruntime-web/wasm");

/** Browser wrapper: lazy-loads the self-hosted runtime and model the first time a swing needs it. */
export class BatDetector {
  private session: import("onnxruntime-web/wasm").InferenceSession | null = null;
  private ort: OrtModule | null = null;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  constructor(private modelUrl = "/models/bat_obb.onnx", private size = 512) {}

  async init() {
    if (this.session) return;
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = 1;   // threads need cross-origin isolation; one thread is enough for ~25 frames per swing
    this.session = await ort.InferenceSession.create(this.modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    this.ort = ort;
  }

  /** `hands` in source-image pixels. */
  async detect(src: CanvasImageSource, W: number, H: number, t: number, hands: Pt | null): Promise<BatPose | null> {
    if (!this.session || !this.ort) await this.init();
    const S = this.size, lb = letterbox(W, H, S);
    this.canvas ??= typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(S, S) : Object.assign(document.createElement("canvas"), { width: S, height: S });
    const g = this.canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.fillStyle = "rgb(114,114,114)"; g.fillRect(0, 0, S, S);
    g.drawImage(src, lb.px, lb.py, lb.nw, lb.nh);
    const px = g.getImageData(0, 0, S, S).data, plane = S * S, x = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) { x[i] = px[i * 4] / 255; x[plane + i] = px[i * 4 + 1] / 255; x[2 * plane + i] = px[i * 4 + 2] / 255; }
    const feeds: Record<string, import("onnxruntime-web/wasm").Tensor> = { [this.session!.inputNames[0]]: new this.ort!.Tensor("float32", x, [1, 3, S, S]) };
    const out = (await this.session!.run(feeds))[this.session!.outputNames[0]];
    const n = out.dims[2];
    const boxes = decodeObb(out.data as Float32Array, n).map((b) => ({ ...b, cx: (b.cx - lb.px) / lb.r, cy: (b.cy - lb.py) / lb.r, w: b.w / lb.r, h: b.h / lb.r }));
    return batFromBoxes(boxes, t, hands);
  }

  close() { void this.session?.release(); this.session = null; }
}
