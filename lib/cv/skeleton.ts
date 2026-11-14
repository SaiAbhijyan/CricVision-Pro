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
