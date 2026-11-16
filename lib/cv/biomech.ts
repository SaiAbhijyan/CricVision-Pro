import { centreOfMass, weightState } from "./com";
import type { BattingBiomech, BowlerArm, BowlingBiomech, Handedness } from "@/lib/types";
import { BOWLER_CREASE_Y, RETURN_CREASE_HALF, clamp, deg, wrap180 } from "@/lib/physics/constants";
import {
  angleAt, angleBetween, horiz, len, mid, mirrorSkeleton, smoothSkeletons, sub, type JointName, type Skeleton,
} from "./skeleton";

/* ===================================================================================
 * Bowling extractor. Works in WORLD space (bowler runs toward +Y; a right-arm bowler's hand is on -X).
 * Left-arm deliveries are mirrored so one implementation covers both.
 * =================================================================================== */

export interface BowlingEvents { bfc: number; ffc: number; release: number }
export interface BowlExtract { biomech: BowlingBiomech; events: BowlingEvents }

const dtAt = (fr: Skeleton[], i: number) => Math.max(1e-4, fr[Math.min(fr.length - 1, i + 1)].t - fr[Math.max(0, i - 1)].t);
const speedOf = (fr: Skeleton[], i: number, k: JointName, planar = false) => {
  const a = fr[Math.max(0, i - 1)].j[k], b = fr[Math.min(fr.length - 1, i + 1)].j[k];
  const d = sub(b, a);
  return (planar ? horiz(d) : len(d)) / dtAt(fr, i);
};
const nearestIdx = (fr: Skeleton[], t: number) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < fr.length; i++) { const d = Math.abs(fr[i].t - t); if (d < bd) { bd = d; bi = i; } }
  return bi;
};
/** shoulder / hip line yaw in the bowler's frame: 0 = square-on to the batter, -90 = side-on (right-arm) */
const yaw = (fr: Skeleton, l: JointName, r: JointName) => {
  const d = sub(fr.j[r], fr.j[l]);
  return deg(Math.atan2(d.y, -d.x));
};

export function extractBowling(frames: Skeleton[], opts: { arm: BowlerArm; releaseHintT?: number }): BowlExtract | null {
  if (frames.length < 12) return null;
  const fr = opts.arm === "L" ? frames.map(mirrorSkeleton) : frames;
  const n = fr.length;
  let floor = Infinity;
  for (const s of fr) floor = Math.min(floor, s.j.lAnk.z, s.j.rAnk.z);
  const grounded = (i: number, k: "lAnk" | "rAnk") => fr[i].j[k].z - floor < 0.03 && speedOf(fr, i, k, true) < 1.6;

  // release = highest bowling-wrist point (near the hint if the ball tracker supplied one)
  let rel = 0, bestZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (opts.releaseHintT !== undefined && Math.abs(fr[i].t - opts.releaseHintT) > 0.25) continue;
    if (fr[i].j.rWr.z > bestZ) { bestZ = fr[i].j.rWr.z; rel = i; }
  }
  // front-foot contact (left foot, planted at release)
  let j = rel;
  while (j > 0 && !grounded(j, "lAnk")) j--;
  while (j > 0 && grounded(j - 1, "lAnk")) j--;
  const ffc = j;
  // back-foot contact (right foot) preceding it
  j = Math.max(0, ffc - 1);
  while (j > 0 && !grounded(j, "rAnk")) j--;
  while (j > 0 && grounded(j - 1, "rAnk")) j--;
  const bfc = Math.min(j, ffc);
  const ffcS = Math.min(n - 1, ffc + 2); // settled frame

  // run-up speed: final ~3 strides (0.9 s) before back-foot contact
  const tB = fr[bfc].t;
  const a = nearestIdx(fr, tB - 0.9), b = nearestIdx(fr, tB - 0.05);
  const hipA = mid(fr[a].j.lHip, fr[a].j.rHip), hipB = mid(fr[b].j.lHip, fr[b].j.rHip);
  const runUp = b > a ? horiz(sub(hipB, hipA)) / Math.max(1e-3, fr[b].t - fr[a].t) : 0;

  // back-foot stability: lateral wobble while loaded
  let path = 0;
  const e1 = nearestIdx(fr, tB + 0.1);
  for (let i = bfc + 1; i <= Math.min(e1, n - 1); i++) path += horiz(sub(fr[i].j.rAnk, fr[i - 1].j.rAnk));
  const stability = clamp(100 * (1 - path / 0.12), 0, 100);

  const stride = horiz(sub(fr[ffcS].j.lAnk, fr[bfc].j.rAnk)) * 100;
  const front = fr[ffcS].j;
  const frontMinY = Math.min(front.lHeel.y, front.lAnk.y, front.lToe.y);
  const over = (frontMinY - BOWLER_CREASE_Y) * 100;
  const back = fr[Math.min(n - 1, bfc + 1)].j;
  const backMaxX = Math.max(Math.abs(back.rHeel.x), Math.abs(back.rAnk.x), Math.abs(back.rToe.x));
  const frontMaxX = Math.max(Math.abs(front.lHeel.x), Math.abs(front.lAnk.x), Math.abs(front.lToe.x));
  const outside = (Math.max(backMaxX, frontMaxX) - RETURN_CREASE_HALF) * 100;

  // elbow: from upper-arm-horizontal to release
  let h = bfc;
  for (let i = bfc; i <= rel; i++) { if (fr[i].j.rEl.z >= fr[i].j.rSh.z) { h = i; break; } h = i; }
  const elbowAt = (i: number) => angleAt(fr[i].j.rSh, fr[i].j.rEl, fr[i].j.rWr);
  const ext = Math.max(0, elbowAt(rel) - elbowAt(h));

  // arm rotation and slot: the shoulder-to-wrist line swinging about the shoulder
  const armVec = (i: number) => sub(fr[i].j.rWr, fr[i].j.rSh);
  const armSlot = angleBetween(armVec(rel), { x: 0, y: 0, z: 1 });
  let armRot = 0;
  for (let i = h + 1; i <= rel; i++) armRot = Math.max(armRot, angleBetween(armVec(i - 1), armVec(i)) / dtAt(fr, i));

  const kneeAt = (i: number) => angleAt(fr[i].j.lHip, fr[i].j.lKn, fr[i].j.lAnk);
  const kneeRel = kneeAt(rel);
  const kneeFfc = kneeAt(ffcS);

  // hip-shoulder separation + counter-rotation
  let xf = 0;
  for (let i = bfc; i <= rel; i++) xf = Math.max(xf, Math.abs(wrap180(yaw(fr[i], "lSh", "rSh") - yaw(fr[i], "lHip", "rHip"))));
  const sBfc = yaw(fr[bfc], "lSh", "rSh");
  let sMin = sBfc;
  for (let i = bfc; i <= Math.max(bfc, ffc); i++) sMin = Math.min(sMin, yaw(fr[i], "lSh", "rSh"));
  const counter = Math.max(0, wrap180(sBfc - sMin));

  // wrist snap: rate of change of the forearm-hand angle around release
  const flex = (i: number) => angleBetween(sub(fr[i].j.rWr, fr[i].j.rEl), sub(fr[i].j.rIdx, fr[i].j.rWr));
  let snap = 0;
  for (let i = Math.max(1, nearestIdx(fr, fr[rel].t - 0.1)); i <= Math.min(n - 2, nearestIdx(fr, fr[rel].t + 0.1)); i++) {
    snap = Math.max(snap, Math.abs(flex(i + 1) - flex(i - 1)) / dtAt(fr, i));
  }
  const armSpeed = speedOf(fr, rel, "rWr");
  const w = fr[rel].j.rWr;
  const releaseX = opts.arm === "L" ? -w.x : w.x;

  return {
    events: { bfc, ffc, release: rel },
    biomech: {
      runUpSpeedMs: runUp,
      backFootStability: stability,
      frontStrideCm: stride,
      frontFootOverCreaseCm: over,
      backFootOutsideReturnCm: outside,
      elbowExtensionDeg: ext,
      elbowFlag: ext > 15,
      elbowHorizDeg: elbowAt(h),
      elbowReleaseDeg: elbowAt(rel),
      armSlotDeg: armSlot,
      armRotationDegS: armRot,
      frontKneeBraceDeg: kneeRel,
      frontKneeCollapseDeg: kneeFfc - kneeRel,
      kneeBraced: kneeRel > 165,
      hipShoulderSepDeg: xf,
      counterRotationDeg: counter,
      counterRotationFlag: counter > 30,
      releaseHeightM: w.z,
      releaseLateralCm: Math.abs(releaseX) * 100,
      releaseXm: releaseX,
      wristSnapDegS: snap,
      armSpeedMs: armSpeed,
      disguiseScore: 100,
    },
  };
}

/* ===================================================================================
 * Batting extractor. Left-handers are mirrored to a canonical right-hander:
 *   left foot = front foot (toward the bowler, -Y), hands: right = bottom, left = top, off side = +X.
 * =================================================================================== */

export interface BatExtract { biomech: BattingBiomech; impactIdx: number; stanceIdx: number; backliftIdx: number }

export function extractBatting(frames: Skeleton[], opts: { hand: Handedness; impactT: number }): BatExtract | null {
  if (frames.length < 10) return null;
  const fr = smoothSkeletons(opts.hand === "LHB" ? frames.map(mirrorSkeleton) : frames);
  const n = fr.length;
  const imp = nearestIdx(fr, opts.impactT);
  const st = 0;
  const hipMid = (i: number) => mid(fr[i].j.lHip, fr[i].j.rHip);

  // weight transfer: whole-body centre of mass projected between the back and front foot (see ./com).
  // Frames are mirrored for left-handers, so the batter always faces with the left foot forward here.
  const wAt = (i: number) => weightState(fr[i].j, "RHB");
  const rawFront = wAt(imp).frontPct;
  const frontPct = clamp(rawFront, 0, 100);
  // weight split stability: the median frame-to-frame change over the last 450 ms. A real weight transfer is smooth; a split
  // that jumps tens of points between neighbouring frames is depth noise from a view that looks along the stride.
  const wJumps: number[] = [];
  for (let i = Math.max(1, nearestIdx(fr, fr[imp].t - 0.45)); i <= imp; i++) wJumps.push(Math.abs(wAt(i).frontPct - wAt(i - 1).frontPct) / Math.max(1, (fr[i].t - fr[i - 1].t) * 30));
  wJumps.sort((a, b) => a - b);
  const wJitter = wJumps.length ? wJumps[Math.floor(wJumps.length / 2)] : 0;
  const comImp = centreOfMass(fr[imp].j), comSt = centreOfMass(fr[st].j);
  const comShiftCm = (comSt.y - comImp.y) * 100; // + = toward the bowler
  // weight-on-front-foot curve: 34 samples from 450 ms before contact to 100 ms after, so shots line up at contact
  const weightSeries: number[] = [];
  for (let k = 0; k < 34; k++) {
    const tt = fr[imp].t - 0.45 + (0.55 * k) / 33;
    weightSeries.push(Math.round(clamp(wAt(nearestIdx(fr, tt)).frontPct, 0, 100) * 10) / 10);
  }

  const stride = horiz(sub(fr[imp].j.lAnk, fr[st].j.lAnk)) * 100;

  // trigger: first sustained movement of the hips / front foot
  let trig = st;
  for (let i = 1; i < imp; i++) {
    const v = Math.max(speedOf(fr, i, "lAnk", true), (horiz(sub(hipMid(Math.min(n - 1, i + 1)), hipMid(Math.max(0, i - 1)))) / dtAt(fr, i)));
    if (v > 0.35) { trig = i; break; }
    trig = i;
  }
  const triggerMs = Math.max(0, (fr[imp].t - fr[trig].t) * 1000);

  // lateral head drift (+ = toward the off side)
  let drift = 0;
  for (let i = st; i <= imp; i++) { const d = fr[i].j.nose.x - fr[st].j.nose.x; if (Math.abs(d) > Math.abs(drift)) drift = d; }

  // backlift peak = highest hands before the downswing
  const handsZ = (i: number) => (fr[i].j.lWr.z + fr[i].j.rWr.z) / 2;
  let bl = st, bz = -Infinity;
  for (let i = st; i <= Math.max(st, imp - 2); i++) if (handsZ(i) > bz) { bz = handsZ(i); bl = i; }
  const handVec = (i: number) => {
    const a = sub(fr[i].j.lIdx, fr[i].j.lWr), b = sub(fr[i].j.rIdx, fr[i].j.rWr);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  };
  const backlift = angleBetween(handVec(bl), { x: 0, y: 0, z: 1 });

  const eV = sub(fr[imp].j.lEl, fr[imp].j.lSh);
  const elbowElev = deg(Math.atan2(eV.z, horiz(eV)));

  let topMax = 0, botMax = 0;
  for (let i = bl; i <= imp; i++) {
    topMax = Math.max(topMax, speedOf(fr, i, "lWr"));
    botMax = Math.max(botMax, speedOf(fr, i, "rWr"));
  }
  const bottomPct = topMax + botMax > 0 ? (botMax / (topMax + botMax)) * 100 : 50;

  const flex = (i: number) => angleBetween(sub(fr[i].j.rWr, fr[i].j.rEl), sub(fr[i].j.rIdx, fr[i].j.rWr));
  let snap = 0;
  const w0 = nearestIdx(fr, fr[imp].t - 0.08), w1 = Math.min(n - 2, nearestIdx(fr, fr[imp].t + 0.08));
  for (let i = Math.max(1, w0); i <= w1; i++) snap = Math.max(snap, Math.abs(flex(i + 1) - flex(i - 1)) / dtAt(fr, i));

  // ---- bat swing: path of the hands from the top of the backlift to contact ----
  const hands = (i: number) => mid(fr[i].j.lWr, fr[i].j.rWr);
  let arc = 0;
  for (let i = bl + 1; i <= imp; i++) arc += len(sub(hands(i), hands(i - 1)));
  const hv = (i: number) => {
    const i0 = Math.max(0, i - 2), i1 = Math.min(n - 1, i + 2);
    const a = hands(i0), b = hands(i1);
    const dt = Math.max(1e-4, fr[i1].t - fr[i0].t);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt };
  };
  let peakHand = 0;
  for (let i = Math.max(bl, imp - 3); i <= Math.min(n - 1, imp + 1); i++) { const v = hv(i); peakHand = Math.max(peakHand, Math.hypot(v.x, v.y, v.z)); }
  const vImp = hv(imp);
  const hSpeed = Math.hypot(vImp.x, vImp.y);
  const attack = deg(Math.atan2(vImp.z, Math.max(1e-6, hSpeed)));
  const path = deg(Math.atan2(vImp.x, Math.max(1e-6, -vImp.y)));
  const rawBat = (3.0 * peakHand + ((snap * Math.PI) / 180) * 0.65) * 3.6;
  const batSpeedKph = clamp(rawBat, 0, 170);
  const unmeasured: ("weight" | "batSpeed")[] = [];
  if (rawFront < -10 || rawFront > 110 || wJitter > 10) unmeasured.push("weight");
  if (rawBat > 150 || peakHand > 16) unmeasured.push("batSpeed");
  const downMs = Math.max(0, (fr[imp].t - fr[bl].t) * 1000);

  // ---- kinetic chain: when did the hips, shoulders and hands each move fastest, relative to contact? ----
  const speedAt = (i: number, pt: (k: number) => { x: number; y: number; z: number }) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    return len(sub(pt(i1), pt(i0))) / Math.max(1e-4, fr[i1].t - fr[i0].t);
  };
  const shMid = (i: number) => mid(fr[i].j.lSh, fr[i].j.rSh);
  const peakT = (pt: (k: number) => { x: number; y: number; z: number }) => {
    let bi = trig, bv = -1;
    for (let i = trig; i <= Math.min(n - 1, imp + 2); i++) { const v = speedAt(i, pt); if (v > bv) { bv = v; bi = i; } }
    return (fr[bi].t - fr[imp].t) * 1000;
  };
  const hipPeak = peakT(hipMid), shPeak = peakT(shMid), handPeak = peakT(hands);
  const chainOrdered = hipPeak <= shPeak + 10 && shPeak <= handPeak + 10;
  const shiftCm = horiz(sub(hipMid(imp), hipMid(st))) * 100;

  const hb = mid(fr[bl].j.lWr, fr[bl].j.rWr), hi = mid(fr[imp].j.lWr, fr[imp].j.rWr);
  const d = sub(hi, hb);
  const plane = deg(Math.atan2(horiz(d), Math.max(1e-6, -d.z)));
  const swing = len(d) > 0.15;

  return {
    impactIdx: imp, stanceIdx: st, backliftIdx: bl,
    biomech: {
      frontFootPct: frontPct, strideCm: stride, triggerMs, headDriftCm: drift * 100, headOverFrontFootCm: +((fr[imp].j.nose.y - fr[imp].j.lAnk.y) * 100).toFixed(1), backliftDeg: backlift,
      frontElbowDeg: elbowElev, bottomHandPct: bottomPct, wristSnapDegS: snap, swingPlaneDeg: plane, swingDetected: swing,
      batSpeedKph, attackAngleDeg: attack, swingPathDeg: path, downswingMs: downMs, swingArcCm: arc * 100,
      weightShiftCm: shiftCm, comShiftCm, weightSeries, hipPeakMs: hipPeak, handPeakMs: handPeak, chainOrdered,
      ...(unmeasured.length ? { unmeasured } : {}),
    },
  };
}

/** The weight split and bat speed are left out wherever the footage could not support them. */
export const weightOk = (b: BattingBiomech | null | undefined): b is BattingBiomech => !!b && !b.unmeasured?.includes("weight");
export const batSpeedOk = (b: BattingBiomech | null | undefined): b is BattingBiomech => !!b && !b.unmeasured?.includes("batSpeed");
