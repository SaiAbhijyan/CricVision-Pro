import type { Vec3 } from "@/lib/types";
import { BALL_MASS, clamp, deg, wrap360 } from "./constants";
import { shotDirection } from "./ballistics";

const M_BAT = 0.9;   // effective bat mass at the impact point (kg)
const E_BAT = 0.55;  // bat-ball coefficient of restitution

export interface BatContactSpec {
  /** ball velocity just before impact (world, m/s) */
  vIn: Vec3;
  /** intended shot direction: azimuth clockwise from straight (toward -Y) and elevation, degrees */
  azimuthDeg: number;
  elevationDeg: number;
  batSpeedMs: number;
  /** 0..1 – sweet-spot efficiency (timing / contact quality) */
  efficiency: number;
}

export interface BatExit { v: Vec3; speedMs: number; azimuthDeg: number; elevationDeg: number; backspinRpm: number }

const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Exit azimuth/elevation of a velocity vector in the repo's shot convention. */
export function velocityToShotAngles(v: Vec3): { azimuthDeg: number; elevationDeg: number } {
  const h = Math.hypot(v.x, v.y);
  return { azimuthDeg: wrap360(deg(Math.atan2(v.x, -v.y))), elevationDeg: deg(Math.atan2(v.z, h)) };
}

/**
 * 1-D collision along the face normal (bisector of incoming/outgoing direction) with a finite-mass bat:
 *   v_n' = ((m - e M)/(m + M)) v_n + ((1 + e) M/(m + M)) v_bat
 * tangential component retained at 70 %.
 */
export function batExit(s: BatContactSpec): BatExit {
  const m = BALL_MASS, M = M_BAT, e = E_BAT;
  const d = shotDirection(s.azimuthDeg);
  const el = (s.elevationDeg * Math.PI) / 180;
  const dir: Vec3 = { x: d.x * Math.cos(el), y: d.y * Math.cos(el), z: Math.sin(el) };
  const vb = s.batSpeedMs * clamp(s.efficiency, 0, 1);
  let speed = Math.hypot(s.vIn.x, s.vIn.y, s.vIn.z);
  let out: Vec3 = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
  for (let k = 0; k < 6; k++) {
    const n = unit({ x: dir.x * speed - s.vIn.x, y: dir.y * speed - s.vIn.y, z: dir.z * speed - s.vIn.z });
    const vn = dot(s.vIn, n);
    const vnOut = ((m - e * M) / (m + M)) * vn + (((1 + e) * M) / (m + M)) * vb;
    const tan: Vec3 = { x: s.vIn.x - vn * n.x, y: s.vIn.y - vn * n.y, z: s.vIn.z - vn * n.z };
    out = { x: vnOut * n.x + 0.7 * tan.x, y: vnOut * n.y + 0.7 * tan.y, z: vnOut * n.z + 0.7 * tan.z };
    speed = Math.hypot(out.x, out.y, out.z);
  }
  const ang = velocityToShotAngles(out);
  return { v: out, speedMs: speed, azimuthDeg: ang.azimuthDeg, elevationDeg: ang.elevationDeg, backspinRpm: clamp((ang.elevationDeg - 8) * 70, -1000, 1800) };
}

/** Edge / thick-edge / under-edge: low-energy deflection behind the bat (toward +Y), azimuth around 180°. */
export function edgeExit(vIn: Vec3, side: -1 | 1, rnd: () => number): BatExit {
  const sp = Math.hypot(vIn.x, vIn.y, vIn.z) * (0.22 + 0.3 * rnd());
  const az = wrap360(180 + side * (8 + 55 * rnd()));
  const el = 4 + 28 * rnd();
  const d = shotDirection(az);
  const c = Math.cos((el * Math.PI) / 180);
  const v: Vec3 = { x: d.x * c * sp, y: d.y * c * sp, z: Math.sin((el * Math.PI) / 180) * sp };
  return { v, speedMs: sp, azimuthDeg: az, elevationDeg: el, backspinRpm: 300 };
}
