/**
 * Parametric 3-D skeleton generators (bowler + batter). They synthesise the same 19-joint stream a MediaPipe
 * session would produce, so the simulator drives the *same* biomechanics extractors as the live camera path.
 * WORLD frame: bowler runs toward +Y; a right-arm bowler's hand is on -X; batter's stumps at y = 20.12.
 */
import type { Handedness, Vec3 } from "@/lib/types";
import { BATTER_CREASE_Y, BOWLER_CREASE_Y, clamp, lerp, rad } from "@/lib/physics/constants";
import { add, mid, mirrorSkeleton, mul, sub, dot, len, type Joints, type Skeleton } from "@/lib/cv/skeleton";

const smooth = (x: number) => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** two-bone IK: joint position between A (root) and B (end) with segment lengths l1,l2 bending toward `pole`. */
function ik(A: Vec3, B: Vec3, l1: number, l2: number, pole: Vec3): Vec3 {
  const d0 = sub(B, A);
  const d = len(d0) || 1e-6;
  const u = mul(d0, 1 / d);
  const dd = clamp(d, 0.05, l1 + l2 - 1e-3);
  let p = sub(pole, mul(u, dot(pole, u)));
  const pl = len(p);
  p = pl > 1e-6 ? mul(p, 1 / pl) : v3(0, 1, 0);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return add(add(A, mul(u, a)), mul(p, h));
}

function hermite(keys: { t: number; y: number; m: number }[], t: number): number {
  if (t <= keys[0].t) return keys[0].y + keys[0].m * (t - keys[0].t);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i], h = b.t - a.t, s = (t - a.t) / h;
      const s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * a.y + (s3 - 2 * s2 + s) * h * a.m + (-2 * s3 + 3 * s2) * b.y + (s3 - s2) * h * b.m;
    }
  }
  const e = keys[keys.length - 1];
  return e.y + e.m * (t - e.t);
}

/* ------------------------------------------------------------------------------------------------ */
/* Bowler                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface BowlerParams {
  fps: number;
  arm: "R" | "L";
  runUpMs: number;
  strideM: number;          // back-foot -> front-foot distance at the delivery stride
  overCm: number;           // heel y minus popping crease, cm (>0 => whole foot over => no-ball)
  releaseX: number;         // world x of the bowling hand at release (right-arm bowler: negative = wide of the stumps on his right)
  backFootX?: number;       // world x of the back foot at back-foot contact (default: just inside the hand line)
  elbowExtDeg: number;
  kneeFfcDeg: number;
  kneeRelDeg: number;
  xFactorDeg: number;
  counterRotDeg: number;
  snapDegS: number;
  torso: number;            // shoulder-to-hip length (m) – drives release height
  stockArmSpeedScale: number;
}

export const defaultBowler = (o: Partial<BowlerParams> = {}): BowlerParams => ({
  fps: 120, arm: "R", runUpMs: 6.8, strideM: 1.55, overCm: -8, releaseX: -0.45,
  elbowExtDeg: 7, kneeFfcDeg: 164, kneeRelDeg: 172, xFactorDeg: 34, counterRotDeg: 14, snapDegS: 1200,
  torso: 0.56, stockArmSpeedScale: 1, ...o,
});

export const BOWLER_TIMES = { bfc: -0.22, ffc: -0.09, rel: 0 };

export function generateBowler(p: BowlerParams): Skeleton[] {
  const fps = p.fps, dt = 1 / fps;
  const t0 = -Math.round(1.7 * fps) / fps, t1 = Math.round(0.5 * fps) / fps;
  const tBFC = BOWLER_TIMES.bfc, tFFC = BOWLER_TIMES.ffc;
  const heelY = BOWLER_CREASE_Y + p.overCm / 100;
  const yFront = heelY + 0.07;            // front ankle (heel is 7 cm behind the ankle)
  const yBack = yFront - p.strideM;
  const backX = p.backFootX ?? p.releaseX - 0.05;
  const yawRel = 10;
  const pelvisX = p.releaseX + 0.2 * Math.cos(rad(yawRel));
  const xFront = pelvisX + 0.05;

  // pelvis y(t)
  const keys = [
    { t: tBFC, y: yBack + 0.05, m: p.runUpMs },
    { t: tFFC, y: yFront - 0.45, m: 2.2 },
    { t: 0, y: yFront - 0.1, m: 2.0 },
    { t: 0.4, y: yFront + 0.55, m: 1.2 },
  ];
  const pelY = (t: number) => (t < tBFC ? keys[0].y + p.runUpMs * (t - tBFC) : hermite(keys, t));

  // foot contact schedules
  type Contact = { ts: number; te: number; x: number; y: number };
  const Ts = 0.28, Tc = 0.14;
  const right: Contact[] = [], left: Contact[] = [];
  right.push({ ts: tBFC, te: tBFC + 0.2, x: backX, y: yBack });
  for (let k = 2; ; k += 2) { const t = tBFC - k * Ts; if (t < t0 - 0.6) break; right.unshift({ ts: t, te: t + Tc, x: pelvisX - 0.12, y: pelY(t) + 0.3 }); }
  left.push({ ts: tFFC, te: 9, x: xFront, y: yFront });
  for (let k = 1; ; k += 2) { const t = tBFC - k * Ts; if (t < t0 - 0.6) break; left.unshift({ ts: t, te: t + Tc, x: pelvisX + 0.12, y: pelY(t) + 0.3 }); }
  right.push({ ts: 0.55, te: 9, x: backX + 0.1, y: yFront + 0.9 });
  const ankle = (cs: Contact[], t: number): Vec3 => {
    if (t <= cs[0].ts) return v3(cs[0].x, cs[0].y, 0.08);
    for (let i = 0; i < cs.length; i++) {
      if (t >= cs[i].ts && t <= cs[i].te) return v3(cs[i].x, cs[i].y, 0.08);
      const n = cs[i + 1];
      if (n && t > cs[i].te && t < n.ts) {
        const u = (t - cs[i].te) / (n.ts - cs[i].te);
        return v3(lerp(cs[i].x, n.x, u), lerp(cs[i].y, n.y, u), 0.08 + 0.3 * Math.sin(Math.PI * u));
      }
    }
    const e = cs[cs.length - 1];
    return v3(e.x, e.y, 0.08);
  };

  // yaw schedules (bowler frame: 0 = square on, -90 = side-on)
  const aSbfc = -50, aSffc = aSbfc - p.counterRotDeg, aHffc = aSffc + p.xFactorDeg, aHbfc = aHffc - 25;
  const sh = (t: number) => {
    if (t < tBFC) return lerp(-10, aSbfc, smooth((t - (tBFC - 0.35)) / 0.35));
    if (t < tFFC) return lerp(aSbfc, aSffc, smooth((t - tBFC) / (tFFC - tBFC)));
    if (t < 0) return lerp(aSffc, yawRel, smooth((t - tFFC) / (0 - tFFC)));
    return lerp(yawRel, 40, smooth(t / 0.3));
  };
  const hp = (t: number) => {
    if (t < tBFC) return lerp(-10, aHbfc, smooth((t - (tBFC - 0.35)) / 0.35));
    if (t < tFFC) return lerp(aHbfc, aHffc, smooth((t - tBFC) / (tFFC - tBFC)));
    if (t < 0) return lerp(aHffc, -5, smooth((t - tFFC) / (0 - tFFC)));
    return lerp(-5, 25, smooth(t / 0.3));
  };

  // arm schedules
  const tH = -0.054 / p.stockArmSpeedScale;
  const alpha = (t: number) => {
    if (t >= tH) return 90 + (90 / (0 - tH)) * (t - tH) + 0;
    return lerp(20, 90, smooth((t - (tBFC - 0.05)) / (tH - (tBFC - 0.05))));
  };
  const alphaFull = (t: number) => (t <= 0 ? alpha(t) : Math.min(380, 180 + (90 / -tH) * t));
  const phiRel = 4;
  const phi = (t: number) => {
    if (t >= tH && t <= 0) return lerp(phiRel + p.elbowExtDeg, phiRel, (t - tH) / (0 - tH));
    if (t > 0) return lerp(phiRel, 20, smooth(t / 0.1));
    return lerp(35, phiRel + p.elbowExtDeg, smooth((t - (tBFC - 0.05)) / (tH - (tBFC - 0.05))));
  };
  const dBeta = (p.snapDegS * 0.07) / 1.5;
  const beta = (t: number) => 5 + dBeta * smooth((t + 0.045) / 0.07);
  const alphaL = (t: number) => (t < tFFC ? lerp(20, 150, smooth((t + 0.4) / (tFFC + 0.4))) : lerp(150, 40, smooth((t - tFFC) / 0.19)));

  // local (r,f,u) -> world:  x = -r, y = f
  const W = (r: number, f: number, u: number): Vec3 => v3(-r, f, u);
  const dir = (a: number) => ({ f: Math.sin(rad(a)), u: -Math.cos(rad(a)) });

  const out: Skeleton[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    const tt = Math.round(t * fps) / fps;
    const aR = ankle(right, tt), aL = ankle(left, tt);
    const psH = rad(hp(tt)), psS = rad(sh(tt));
    const pelXY = { x: pelvisX, y: pelY(tt) };
    // pelvis height: free-running bob, then solved so the front knee has the commanded angle
    let uP = 0.98 + 0.03 * Math.sin(tt * 18);
    if (tt > tFFC - 0.15) {
      const th = lerp(p.kneeFfcDeg, p.kneeRelDeg, smooth((tt - tFFC) / (0 - tFFC)));
      const thT = tt > 0 ? lerp(p.kneeRelDeg, 176, smooth(tt / 0.3)) : th;
      const dleg = 0.88 * Math.sin(rad(thT) / 2);
      const hipL = v3(pelXY.x + 0.14 * Math.cos(psH), pelXY.y - 0.14 * Math.sin(psH), 0);
      const dh = Math.hypot(hipL.x - aL.x, hipL.y - aL.y);
      const uSolve = aL.z + Math.sqrt(Math.max(0.01, dleg * dleg - dh * dh));
      uP = lerp(uP, uSolve, smooth((tt - (tFFC - 0.15)) / 0.15));
    }
    const pel = v3(pelXY.x, pelXY.y, uP);
    // hips (local lateral axis (cos,sin) in (r,f))
    const hipR = add(pel, W(0.14 * Math.cos(psH), 0.14 * Math.sin(psH), 0));
    const hipLj = add(pel, W(-0.14 * Math.cos(psH), -0.14 * Math.sin(psH), 0));
    // (pel is world; W gives world deltas)
    const lean = lerp(-0.04, 0.1, smooth((tt - tBFC) / (0 - tBFC)));
    const S = add(pel, v3(0, lean, p.torso));
    const rSh = add(S, W(0.2 * Math.cos(psS), 0.2 * Math.sin(psS), 0));
    const lSh = add(S, W(-0.2 * Math.cos(psS), -0.2 * Math.sin(psS), 0));
    const aa = alphaFull(tt), pf = phi(tt);
    const d1 = dir(aa), d2 = dir(aa - pf), d3 = dir(aa - pf + beta(tt));
    const rEl = add(rSh, v3(0, 0.3 * d1.f, 0.3 * d1.u));
    const rWr = add(rEl, v3(0, 0.27 * d2.f, 0.27 * d2.u));
    const rIdx = add(rWr, v3(0, 0.09 * d3.f, 0.09 * d3.u));
    const dl = dir(alphaL(tt));
    const lEl = add(lSh, v3(0, 0.3 * dl.f, 0.3 * dl.u));
    const lWr = add(lEl, v3(0, 0.27 * dl.f, 0.27 * dl.u));
    const lIdx = add(lWr, v3(0, 0.09 * dl.f, 0.09 * dl.u));
    const pole = v3(0, 1, 0);
    const lKn = ik(hipLj, aL, 0.44, 0.44, pole), rKn = ik(hipR, aR, 0.44, 0.44, pole);
    const foot = (a: Vec3) => ({ heel: add(a, v3(0, -0.07, -0.06)), toe: add(a, v3(0, 0.17, -0.06)) });
    const fL = foot(aL), fR = foot(aR);
    const nose = add(S, v3(0, 0.07, 0.27));
    const j: Joints = {
      nose, lSh, rSh, lEl, rEl, lWr, rWr, lIdx, rIdx, lHip: hipLj, rHip: hipR, lKn, rKn,
      lAnk: aL, rAnk: aR, lHeel: fL.heel, rHeel: fR.heel, lToe: fL.toe, rToe: fR.toe,
    };
    out.push({ t: tt, j });
  }
  return p.arm === "L" ? out.map(mirrorSkeleton) : out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Batter                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface BatterParams {
  fps: number;
  hand: Handedness;
  impactT: number;          // seconds after ball release
  triggerT: number;         // seconds after ball release when the trigger movement starts
  strideM: number;
  frontFootPct: number;
  headDriftCm: number;      // + toward the off side
  backliftDeg: number;
  swingPlaneDeg: number;
  elbowPoleDeg: number;
  swing: boolean;           // false = leave / no stroke (hands barely move)
  shotYawDeg: number;
}

export const defaultBatter = (o: Partial<BatterParams> = {}): BatterParams => ({
  fps: 120, hand: "RHB", impactT: 0.55, triggerT: 0.18, strideM: 0.55, frontFootPct: 75, headDriftCm: 3, backliftDeg: 25,
  swingPlaneDeg: 30, elbowPoleDeg: 40, swing: true, shotYawDeg: 25, ...o,
});

export function generateBatter(p: BatterParams): Skeleton[] {
  const fps = p.fps, dt = 1 / fps;
  const t0 = -0.3, t1 = p.impactT + 0.4;
  const yB = BATTER_CREASE_Y + 0.15;          // back foot
  const stance = { back: v3(0.0, yB, 0.08), front: v3(0.1, yB - 0.3, 0.08) };
  const tTrig = p.triggerT, tImp = p.impactT, tLand = tImp - 0.06, tBL = tImp - 0.25;
  const P = clamp(p.frontFootPct / 100, 0, 1);
  const bl = { x: 0.05, y: yB + 0.1, z: 1.2 };
  const drop = bl.z - 0.55;
  const hDist = Math.tan(rad(p.swingPlaneDeg)) * drop;
  const imp = { x: 0.2, y: bl.y - hDist, z: 0.55 };
  const stanceHands = { x: 0.12, y: yB - 0.15, z: 0.9 };
  const out: Skeleton[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    const tt = Math.round(t * fps) / fps;
    const sStride = smooth((tt - tTrig) / (tLand - tTrig));
    const front = v3(stance.front.x + 0.1 * sStride, stance.front.y - p.strideM * sStride, 0.08 + (tt > tTrig && tt < tLand ? 0.1 * Math.sin(Math.PI * sStride) : 0));
    const back = v3(stance.back.x, stance.back.y, 0.08);
    const pTarget = 0.5 + (P - 0.5) * smooth((tt - tTrig) / (tImp - tTrig));
    const hip = v3(back.x + pTarget * (front.x - back.x), back.y + pTarget * (front.y - back.y), 0.97 - 0.1 * sStride);
    const gam = rad(p.shotYawDeg * smooth((tt - tTrig) / (tImp - tTrig)));
    // local (r,f) -> world: x = r, y = -f
    const L = (r: number, f: number, z: number) => v3(r, -f, z);
    const hipL = add(hip, L(-0.14 * Math.sin(gam * 0.7), 0.14 * Math.cos(gam * 0.7), 0));
    const hipR = add(hip, L(0.14 * Math.sin(gam * 0.7), -0.14 * Math.cos(gam * 0.7), 0));
    const S = add(hip, v3(0, -0.06 * sStride, 0.52));
    const lSh = add(S, L(-0.2 * Math.sin(gam), 0.2 * Math.cos(gam), 0));
    const rSh = add(S, L(0.2 * Math.sin(gam), -0.2 * Math.cos(gam), 0));
    const headX = 0.05 + 0.1 + (p.headDriftCm / 100) * smooth((tt - tTrig) / (tImp - tTrig));
    const nose = v3(headX, S.y - 0.1 * Math.sin(gam), S.z + 0.28);

    // hands
    let hm: Vec3, theta: number;
    if (!p.swing) {
      const s = smooth((tt - tTrig) / 0.3);
      hm = v3(stanceHands.x, lerp(stanceHands.y, bl.y - 0.05, s * 0.4), lerp(stanceHands.z, 1.0, s * 0.4));
      theta = -p.backliftDeg * 0.5 * s - 10;
    } else if (tt < tBL) {
      const s = smooth((tt - tTrig) / (tBL - tTrig));
      hm = v3(lerp(stanceHands.x, bl.x, s), lerp(stanceHands.y, bl.y, s), lerp(stanceHands.z, bl.z, s));
      theta = lerp(-10, -p.backliftDeg, s);
    } else if (tt <= tImp) {
      const s = smooth((tt - tBL) / (tImp - tBL));
      hm = v3(lerp(bl.x, imp.x, s), lerp(bl.y, imp.y, s), lerp(bl.z, imp.z, s));
      theta = lerp(-p.backliftDeg, 150, s);
    } else {
      const s = smooth((tt - tImp) / 0.35);
      hm = v3(lerp(imp.x, imp.x - 0.1, s), lerp(imp.y, imp.y - 0.45, s), lerp(imp.z, 1.3, s));
      theta = lerp(150, 200, s);
    }
    const dirW = v3(0, -Math.sin(rad(theta)), Math.cos(rad(theta)));
    const lWr = add(hm, v3(-0.04, 0, 0.08)), rWr = add(hm, v3(0.04, 0, -0.08));
    const lIdx = add(lWr, mul(dirW, 0.09)), rIdx = add(rWr, mul(dirW, 0.09));
    const ep = rad(p.elbowPoleDeg);
    const lEl = ik(lSh, lWr, 0.3, 0.27, v3(0, -Math.cos(ep), Math.sin(ep)));
    const rEl = ik(rSh, rWr, 0.3, 0.27, v3(0.6, 0.5, -0.3));
    const pole = v3(0, -1, 0);
    const lKn = ik(hipL, front, 0.44, 0.44, pole), rKn = ik(hipR, back, 0.44, 0.44, pole);
    const foot = (a: Vec3) => ({ heel: add(a, v3(0, 0.07, -0.06)), toe: add(a, v3(0, -0.17, -0.06)) });
    const fL = foot(front), fR = foot(back);
    out.push({
      t: tt,
      j: {
        nose, lSh, rSh, lEl, rEl, lWr, rWr, lIdx, rIdx, lHip: hipL, rHip: hipR, lKn, rKn,
        lAnk: front, rAnk: back, lHeel: fL.heel, rHeel: fR.heel, lToe: fL.toe, rToe: fR.toe,
      },
    });
  }
  return p.hand === "LHB" ? out.map(mirrorSkeleton) : out;
}

export const midOf = mid;
