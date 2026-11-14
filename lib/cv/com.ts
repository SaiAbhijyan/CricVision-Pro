import { JOINTS, type Joints, type JointName } from "./skeleton";
import type { Handedness, Vec3 } from "@/lib/types";

/**
 * Whole-body centre of mass from the 19 tracked joints, using the segment mass fractions and centre positions of
 * de Leva (1996, adjusted Zatsiorsky-Seluyanov, male): head, trunk, upper arms, forearms, hands, thighs, shanks, feet.
 * Weight transfer is the CoM projected onto the line between the two feet (the base of support):
 * 0 % = all weight on the back foot, 100 % = all on the front foot. Outside 0..100 means the CoM left the base.
 */
export interface Segment { name: string; m: number; p: Vec3 }

const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u });
const mid = (a: Vec3, b: Vec3) => lerp3(a, b, 0.5);

export function segments(j: Joints): Segment[] {
  const sh = mid(j.lSh, j.rSh), hip = mid(j.lHip, j.rHip);
  const out: Segment[] = [
    { name: "head", m: 0.0694, p: { x: j.nose.x, y: j.nose.y, z: j.nose.z + 0.04 } },
    { name: "trunk", m: 0.4346, p: lerp3(sh, hip, 0.45) },
  ];
  for (const s of ["l", "r"] as const) {
    const k = (n: string) => (s + n) as JointName;
    out.push(
      { name: s + "UpperArm", m: 0.0271, p: lerp3(j[k("Sh")], j[k("El")], 0.577) },
      { name: s + "Forearm", m: 0.0162, p: lerp3(j[k("El")], j[k("Wr")], 0.457) },
      { name: s + "Hand", m: 0.0061, p: lerp3(j[k("Wr")], j[k("Idx")], 0.5) },
      { name: s + "Thigh", m: 0.1416, p: lerp3(j[k("Hip")], j[k("Kn")], 0.409) },
      { name: s + "Shank", m: 0.0433, p: lerp3(j[k("Kn")], j[k("Ank")], 0.446) },
      { name: s + "Foot", m: 0.0137, p: lerp3(j[k("Heel")], j[k("Toe")], 0.4415) },
    );
  }
  return out;
}

export function centreOfMass(j: Joints): Vec3 {
  let x = 0, y = 0, z = 0, M = 0;
  for (const s of segments(j)) { x += s.m * s.p.x; y += s.m * s.p.y; z += s.m * s.p.z; M += s.m; }
  return { x: x / M, y: y / M, z: z / M };
}

/** Ground contact point of a foot: the middle of heel and toe. */
export const footPoint = (j: Joints, side: "l" | "r"): Vec3 => mid(j[(side + "Heel") as JointName], j[(side + "Toe") as JointName]);

/** Which side is the front foot: a right-hander faces the bowler with the left foot forward. */
export const frontSide = (hand: Handedness): "l" | "r" => (hand === "RHB" ? "l" : "r");

export interface WeightState { com: Vec3; back: Vec3; front: Vec3; ground: Vec3; frontPct: number }

export function weightState(j: Joints, hand: Handedness): WeightState {
  const fs = frontSide(hand), bs = fs === "l" ? "r" : "l";
  const com = centreOfMass(j), back = footPoint(j, bs), front = footPoint(j, fs);
  // forward/back along the pitch: the question is how much weight is going toward the bowler. Feet side by side = no base to read.
  const dy = front.y - back.y;
  const s = Math.abs(dy) > 0.06 ? (com.y - back.y) / dy : 0.5;
  return { com, back, front, ground: { x: com.x, y: com.y, z: 0 }, frontPct: Math.max(-25, Math.min(125, s * 100)) };
}

import type { ClipComFrame, Pt } from "@/lib/types";
import type { Skeleton } from "./skeleton";

/** Image-space overlay of the centre of mass for one frame: the CoM, its plumb point, the feet, the weight split and the segment centres. */
export function comOverlay(proj: (p: Vec3) => Pt | null, s: Skeleton, prev: Skeleton | undefined, hand: Handedness, scale = 1): ClipComFrame | null {
  const w = weightState(s.j, hand);
  const c = proj(w.com), g = proj(w.ground), b = proj(w.back), f = proj(w.front);
  if (!c || !g || !b || !f) return null;
  const k = (p: Pt) => ({ x: p.x * scale, y: p.y * scale });
  const seg: ClipComFrame["seg"] = [];
  for (const sg of segments(s.j)) { const p = proj(sg.p); if (p) seg.push({ ...k(p), w: sg.m }); }
  let fwd = 0;
  if (prev && s.t > prev.t) fwd = Math.max(-8, Math.min(8, -(w.com.y - centreOfMass(prev.j).y) / (s.t - prev.t)));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const sd = segments(s.j);
  const side = {
    j: JOINTS.flatMap((n) => [r3(s.j[n].y), r3(s.j[n].z)]),
    seg: sd.flatMap((q) => [r3(q.p.y), r3(q.p.z), q.m]),
    c: [r3(w.com.y), r3(w.com.z)] as [number, number], b: r3(w.back.y), f: r3(w.front.y),
  };
  return { side, c: k(c), g: k(g), back: k(b), front: k(f), pct: Math.round(Math.max(0, Math.min(100, w.frontPct)) * 10) / 10, fwd: Math.round(fwd * 100) / 100, seg };
}
