import type { CameraModel, Pt, Vec3 } from "@/lib/types";
import { project } from "@/lib/physics/homography";

/** The 19 BlazePose joints CricVision uses, expressed in WORLD metres (see lib/types.ts for the frame). */
export const JOINTS = [
  "nose", "lSh", "rSh", "lEl", "rEl", "lWr", "rWr", "lIdx", "rIdx",
  "lHip", "rHip", "lKn", "rKn", "lAnk", "rAnk", "lHeel", "rHeel", "lToe", "rToe",
] as const;
export type JointName = (typeof JOINTS)[number];
export type Joints = Record<JointName, Vec3>;
export interface Skeleton { t: number; j: Joints }

export const MP_INDEX: Record<JointName, number> = {
  nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lIdx: 19, rIdx: 20,
  lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

export const BONES: [JointName, JointName][] = [
  ["lSh", "rSh"], ["lSh", "lEl"], ["lEl", "lWr"], ["lWr", "lIdx"], ["rSh", "rEl"], ["rEl", "rWr"], ["rWr", "rIdx"],
  ["lSh", "lHip"], ["rSh", "rHip"], ["lHip", "rHip"], ["lHip", "lKn"], ["lKn", "lAnk"], ["rHip", "rKn"], ["rKn", "rAnk"],
  ["lAnk", "lHeel"], ["lHeel", "lToe"], ["lAnk", "lToe"], ["rAnk", "rHeel"], ["rHeel", "rToe"], ["rAnk", "rToe"],
];

const swapLR = (k: JointName): JointName => {
  if (k === "nose") return k;
  return ((k[0] === "l" ? "r" : "l") + k.slice(1)) as JointName;
};

/** Mirror about the pitch centre line (x -> -x) and swap left/right: lets one extractor serve both arms / handedness. */
export function mirrorSkeleton(s: Skeleton): Skeleton {
  const j = {} as Joints;
  for (const k of JOINTS) {
    const p = s.j[k];
    j[swapLR(k)] = { x: -p.x, y: p.y, z: p.z };
  }
  return { t: s.t, j };
}

export const cloneSkeleton = (s: Skeleton): Skeleton => {
  const j = {} as Joints;
  for (const k of JOINTS) j[k] = { ...s.j[k] };
  return { t: s.t, j };
};

/**
 * Lift a MediaPipe detection into WORLD space.
 *  - `img`  normalised image landmarks (x,y in 0..1)
 *  - `wld`  MediaPipe world landmarks (metres, hip-centred, camera-aligned axes: x right, y down, z away)
 * The hip centre is placed by intersecting its pixel ray with the horizontal plane at the (estimated) hip height.
 */
export function liftToWorld(
  cam: CameraModel, img: { x: number; y: number }[], wld: Vec3[], t: number,
): Skeleton | null {
  if (img.length < 33 || wld.length < 33) return null;
  const { R, f, cx, cy } = cam;
  const Rt = (v: Vec3): Vec3 => ({
    x: R[0] * v.x + R[3] * v.y + R[6] * v.z,
    y: R[1] * v.x + R[4] * v.y + R[7] * v.z,
    z: R[2] * v.x + R[5] * v.y + R[8] * v.z,
  });
  const off = {} as Joints;
  for (const k of JOINTS) off[k] = Rt(wld[MP_INDEX[k]]);
  const ankleZ = (off.lAnk.z + off.rAnk.z) / 2;
  const hipH = Math.max(0.6, -ankleZ + 0.07);
  const hipPx = {
    x: ((img[23].x + img[24].x) / 2) * cam.imageWidth,
    y: ((img[23].y + img[24].y) / 2) * cam.imageHeight,
  };
  const d = Rt({ x: (hipPx.x - cx) / f, y: (hipPx.y - cy) / f, z: 1 });
  const C: Vec3 = {
    x: -(R[0] * cam.t[0] + R[3] * cam.t[1] + R[6] * cam.t[2]),
    y: -(R[1] * cam.t[0] + R[4] * cam.t[1] + R[7] * cam.t[2]),
    z: -(R[2] * cam.t[0] + R[5] * cam.t[1] + R[8] * cam.t[2]),
  };
  if (Math.abs(d.z) < 1e-6) return null;
  const s = (hipH - C.z) / d.z;
  if (s <= 0) return null;
  const P: Vec3 = { x: C.x + s * d.x, y: C.y + s * d.y, z: hipH };
  const hipMidOff = {
    x: (off.lHip.x + off.rHip.x) / 2, y: (off.lHip.y + off.rHip.y) / 2, z: (off.lHip.z + off.rHip.z) / 2,
  };
  const j = {} as Joints;
  for (const k of JOINTS) {
    j[k] = { x: P.x + off[k].x - hipMidOff.x, y: P.y + off[k].y - hipMidOff.y, z: P.z + off[k].z - hipMidOff.z };
  }
  return { t, j };
}

export function projectSkeleton(cam: CameraModel, s: Skeleton): Record<JointName, Pt | null> {
  const out = {} as Record<JointName, Pt | null>;
  for (const k of JOINTS) out[k] = project(cam, s.j[k]);
  return out;
}

/* ---------------- small vector helpers shared by the extractors ---------------- */
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const mul = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
export const horiz = (a: Vec3) => Math.hypot(a.x, a.y);
/** interior angle at b (degrees) between b->a and b->c */
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(a, b), v = sub(c, b);
  const d = dot(u, v) / ((len(u) * len(v)) || 1e-9);
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}
export function angleBetween(u: Vec3, v: Vec3): number {
  const d = dot(u, v) / ((len(u) * len(v)) || 1e-9);
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

/**
 * Lift a MediaPipe detection into world space for a long-lens, fixed camera behind the bowler (typical broadcast and
 * tripod footage). With a long lens the picture is nearly orthographic, so a calibrated 4-corner homography is not
 * needed: the hip centre is placed from its pixel position at a known scale, and the body shape comes from MediaPipe's
 * metric world landmarks, tilted by the camera's downward pitch.
 *  - `metresPerPx`  scale at the batter, e.g. 3.05 m pitch width / its width in pixels
 *  - `refPx`        the pixel column that is the pitch centre line
 *  - `pitchDeg`     how far the camera looks down (about 10-20 deg for broadcast)
 *  - `hipY`         world Y given to the hip centre (the batter stays near the crease; stride comes from the body shape)
 */
export function liftWeakPerspective(
  img: { x: number; y: number }[], wld: Vec3[], t: number,
  o: { metresPerPx: number; refPx: number; imageWidth: number; pitchDeg: number; hipY: number },
): Skeleton | null {
  if (img.length < 33 || wld.length < 33) return null;
  const th = (o.pitchDeg * Math.PI) / 180, s = Math.sin(th), c = Math.cos(th);
  const off = {} as Joints;
  for (const k of JOINTS) { const w = wld[MP_INDEX[k]]; off[k] = { x: w.x, y: -w.y * s + w.z * c, z: -w.y * c - w.z * s }; }
  const ankleZ = (off.lAnk.z + off.rAnk.z) / 2;
  const hipH = Math.max(0.6, -ankleZ + 0.07);
  const hx = ((img[23].x + img[24].x) / 2) * o.imageWidth;
  const P = { x: (hx - o.refPx) * o.metresPerPx, y: o.hipY, z: hipH };
  const hm = { x: (off.lHip.x + off.rHip.x) / 2, y: (off.lHip.y + off.rHip.y) / 2, z: (off.lHip.z + off.rHip.z) / 2 };
  const j = {} as Joints;
  for (const k of JOINTS) j[k] = { x: P.x + off[k].x - hm.x, y: P.y + off[k].y - hm.y, z: P.z + off[k].z - hm.z };
  return { t, j };
}

/** Centred moving average of every joint over +-`halfWinS` seconds (at least one neighbour each side). Pose landmarks
 *  jitter by a few centimetres frame to frame; speeds and the weight split are differences of positions, so they amplify it. */
export function smoothSkeletons(frames: Skeleton[], halfWinS = 0.05): Skeleton[] {
  const n = frames.length;
  return frames.map((f, i) => {
    let a = i, b = i;
    while (a > 0 && (f.t - frames[a - 1].t <= halfWinS || a === i)) a--;
    while (b < n - 1 && (frames[b + 1].t - f.t <= halfWinS || b === i)) b++;
    const j = {} as Joints;
    for (const k of JOINTS) {
      let x = 0, y = 0, z = 0;
      for (let q = a; q <= b; q++) { const p = frames[q].j[k]; x += p.x; y += p.y; z += p.z; }
      const m = b - a + 1; j[k] = { x: x / m, y: y / m, z: z / m };
    }
    return { t: f.t, j };
  });
}

type LM = { x: number; y: number; visibility?: number };

/** Pixel height of a detected person, nose to the lower ankle (used to pick the main subject and to set the scale). */
export function personPixelHeight(lmk: LM[], W: number, H: number) {
  const ank = Math.max(lmk[27].y, lmk[28].y) * H, nose = lmk[0].y * H;
  const dx = ((lmk[27].x + lmk[28].x) / 2 - lmk[0].x) * W;
  return Math.hypot(dx, ank - nose);
}

/**
 * Camera-agnostic lift for batting-only footage (no pitch calibration): scale from the person's own height (nose to ankle is
 * about 0.87 of standing height), body shape from MediaPipe's metric world landmarks. The axes are the camera's (x right,
 * y away, z up); `alignToStance` later turns them so the batter faces the bowler.
 */
export function liftBodyScaled(lmk: LM[], wld: Vec3[], t: number, W: number, H: number, statureM: number): Skeleton | null {
  if (lmk.length < 33 || wld.length < 33) return null;
  const px = personPixelHeight(lmk, W, H);
  if (px < 40) return null;
  return liftWeakPerspective(lmk, wld, t, { metresPerPx: (0.87 * statureM) / px, refPx: W / 2, imageWidth: W, pitchDeg: 0, hipY: 0 });
}

/** The person to analyse: the one nearest `near` (normalised image point, e.g. where the user tapped the batter, then the
 *  last position followed) when given, else the biggest person in the frame. -1 when nobody fits. */
export function mainSubject(people: LM[][], W: number, H: number, near?: { x: number; y: number } | null): number {
  if (near) {
    let bi = -1, bd = 0.15;   // at most 15% of the frame from where the batter was
    people.forEach((p, i) => { if (p.length >= 33) { const d = Math.hypot((p[23].x + p[24].x) / 2 - near.x, ((p[23].y + p[24].y) / 2 - near.y) * (H / W)); if (d < bd) { bd = d; bi = i; } } });
    return bi;
  }
  let best = -1, bh = 0;
  people.forEach((p, i) => { if (p.length >= 33) { const h = personPixelHeight(p, W, H); if (h > bh) { bh = h; best = i; } } });
  return best;
}

/**
 * Follows one person through a clip. Picking "the biggest person" afresh each frame flips between the batter, the keeper and
 * the umpire when they are similar in size (seen on real broadcast footage). Start from the tapped point or the biggest person,
 * then keep whoever is nearest the last position. Lost for more than `patienceFrames`: a tapped batter is waited for; otherwise
 * the biggest person is taken again (e.g. after a camera cut).
 */
export class SubjectFollower {
  private at: { x: number; y: number } | null;
  private miss = 0;
  constructor(private tapped: { x: number; y: number } | null = null, private patienceFrames = 15) { this.at = tapped; }
  pick(people: LM[][], W: number, H: number): number {
    let i = this.at ? mainSubject(people, W, H, this.at) : -1;
    if (i < 0) {
      this.miss++;
      if (this.at && (this.tapped || this.miss <= this.patienceFrames)) return -1;
      i = mainSubject(people, W, H);
      if (i < 0) return -1;
    }
    const L = people[i]; this.at = { x: (L[23].x + L[24].x) / 2, y: (L[23].y + L[24].y) / 2 }; this.miss = 0;
    return i;
  }
}
