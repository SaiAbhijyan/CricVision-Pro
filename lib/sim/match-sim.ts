/**
 * Virtual Match Simulator: runs full deliveries through the *same* engines the live camera path uses
 * (skeleton -> biomech extractors, aerodynamic ball flight, bat-ball collision, field interception, MCC umpiring).
 */
import type {
  BallOutcome, BallRecord, BattingBiomech, BowlerArm, BowlingBiomech, DeliveryFlight, DismissalKind, ExtraKind,
  FieldPlayer, LengthClass, LineClass, SessionConfig, ShotBallistics, ShotType, TimingClass, Vec3,
} from "@/lib/types";
import {
  BATTER_CREASE_Y, BOWLER_CREASE_Y, PITCH_LENGTH, clamp, lerp, toKph, wrap360,
} from "@/lib/physics/constants";
import { simulateDelivery, simulateShot, type DeliverySpec, type ShotResult } from "@/lib/physics/ballistics";
import { batExit, edgeExit } from "@/lib/physics/bat";
import { extractBatting, extractBowling } from "@/lib/cv/biomech";
import type { Skeleton } from "@/lib/cv/skeleton";
import { resolveFielding, buildPreset, type PresetName, type FieldResolution } from "@/lib/rules/field";
import {
  classifyLength, classifyLine, isBowled, judgeExtras, lbwVerdict, offSign, stateAtT, stateAtY, timeAtY,
} from "@/lib/rules/umpire";
import { classifyShot, classifyTiming, relativeAzimuth } from "@/lib/rules/shot";
import { applyOutcome, newScore, type ScoreState, type WagonPoint } from "@/lib/rules/scoreboard";
import { defaultBatter, defaultBowler, generateBatter, generateBowler } from "./synth-pose";
import { between, gauss, mulberry32, pick, weighted, type Rng } from "./rng";

export interface SimBall {
  record: BallRecord;
  flight: DeliveryFlight;
  shot: ShotResult | null;
  bowlerFrames: Skeleton[];
  batterFrames: Skeleton[];
  contactT: number | null;
  contactPos: Vec3 | null;
}

export interface SimOptions {
  cfg: SessionConfig;
  balls: number;
  seed: number;
  fieldPreset?: PresetName;
  startedAt?: number;
  /** 0..1 batting skill of the virtual batter */
  batterSkill?: number;
}

export const armOf = (cfg: SessionConfig): BowlerArm =>
  cfg.bowlerStyle === "Left Arm Pace" ? "L" : cfg.bowlerStyle === "Right Arm Pace" ? "R" : cfg.bowlerArm;
const isSpin = (s: SessionConfig["bowlerStyle"]) => s === "Off-Spin" || s === "Leg-Spin";

export function defaultFieldPreset(cfg: SessionConfig): PresetName {
  if (cfg.format === "Super Over") return "Death Overs";
  if (cfg.format === "Powerplay Chase") return "Powerplay";
  return isSpin(cfg.bowlerStyle) ? "Spin Attack" : "Test Off-Side Ring";
}

export function buildField(cfg: SessionConfig, preset: PresetName): FieldPlayer[] {
  const f = buildPreset(preset, cfg.handedness, cfg.boundaryRadius);
  return f.map((p) => (p.keeper ? { ...p, y: PITCH_LENGTH + (isSpin(cfg.bowlerStyle) ? 1.2 : 13) } : p));
}

interface Ctx { cfg: SessionConfig; field: FieldPlayer[]; rng: Rng; score: ScoreState; index: number; total: number; skill: number; startedAt: number }

/* ----------------------------------------- bowling plan ----------------------------------------- */

function bowlingPlan(ctx: Ctx) {
  const { cfg, rng } = ctx;
  const arm = armOf(cfg);
  const fat = ctx.index / Math.max(1, ctx.total);
  const spin = isSpin(cfg.bowlerStyle);
  const variation = rng() < 0.15;
  const over = cfg.bowlingAngle === "Over the Wicket";
  // right-arm: over the wicket => hand on -X (bowler's right); round the wicket => +X. generateBowler works in right-arm space.
  const baseX = over ? -0.38 : 0.7;
  const bp = defaultBowler({
    arm,
    runUpMs: (spin ? 3.6 : 6.9) - 0.5 * fat + gauss(rng) * 0.12,
    strideM: (spin ? 1.2 : 1.55) + gauss(rng) * 0.04,
    overCm: -10 + gauss(rng) * 3.5 + 5 * fat + (rng() < 0.04 ? 16 : 0),
    releaseX: arm === "R" ? baseX : -baseX,
    elbowExtDeg: 6 + gauss(rng) * 1.5 + (rng() < 0.03 ? 12 : 0),
    kneeFfcDeg: 164 - 3 * fat,
    kneeRelDeg: 174 - 14 * fat * rng() + gauss(rng) * 1.5,
    xFactorDeg: 32 + gauss(rng) * 3,
    counterRotDeg: 12 + 16 * fat + gauss(rng) * 3,
    snapDegS: (spin ? 1500 : 1200) - (variation ? 250 : 0) + gauss(rng) * 60,
    torso: 0.56 + gauss(rng) * 0.008 + (variation ? -0.045 : 0),
    stockArmSpeedScale: variation ? 0.85 : 1 + gauss(rng) * 0.01,
  });
  if (rng() < 0.03) bp.releaseX = -1.5; // arm/back foot drifting out wide (return crease)
  return { bp, arm, variation, spin };
}

function chooseTarget(ctx: Ctx, spin: boolean, variation: boolean, xr: number) {
  const { rng, cfg } = ctx;
  const os = offSign(cfg.handedness);
  const len = weighted<LengthClass>(rng, spin ? [["Full", 0.3], ["Good", 0.55], ["Short", 0.13], ["Yorker", 0.02]] : [["Full", 0.27], ["Good", 0.45], ["Short", 0.17], ["Yorker", 0.11]]);
  const yFromBatter = { Yorker: between(rng, 0.7, 1.7), Full: between(rng, 2.3, 4.8), Good: between(rng, 5.3, 7.8), Short: between(rng, 8.3, 10.8) }[len];
  const line = weighted<LineClass>(rng, [["Off Channel", 0.38], ["Middle", 0.24], ["Leg", 0.16], ["Wide Off", 0.14], ["Wide Leg", 0.08]]);
  const off = { "Wide Off": between(rng, 0.7, 1.0), "Off Channel": between(rng, 0.2, 0.55), Middle: between(rng, -0.1, 0.1), Leg: between(rng, -0.55, -0.2), "Wide Leg": between(rng, -1.0, -0.7) }[line];
  void variation;
  const yb = PITCH_LENGTH - yFromBatter;
  const xd = off * os;                       // desired line at the batter's stumps
  const yr = BOWLER_CREASE_Y + 0.45;
  const x = xr + (xd - xr) * ((yb - yr) / (PITCH_LENGTH - yr));
  return { x, y: yb };
}

/* ------------------------------------------ batting plan ------------------------------------------ */

type Intent = "leave" | "defend" | "drive" | "cut" | "pull" | "flick" | "sweep" | "reverse";

function battingPlan(ctx: Ctx, flight: DeliveryFlight, length: LengthClass | null, line: LineClass | null, spin: boolean) {
  const { rng, cfg, skill } = ctx;
  const aggr = { "Net Free-Hit": 0.55, "Super Over": 0.9, "Powerplay Chase": 0.8 }[cfg.format] * (0.6 + 0.4 * skill);
  const arr = stateAtY(flight, BATTER_CREASE_Y);
  const os = offSign(cfg.handedness);
  const xRel = arr ? arr.p.x * os : 0;
  let intent: Intent;
  if (arr && (xRel > 0.75 || arr.p.z > 1.7) && rng() < 0.85) intent = "leave";
  else if (length === "Short") intent = line === "Wide Off" || line === "Off Channel" ? "cut" : "pull";
  else if (spin && (length === "Full" || length === "Good") && rng() < 0.18 * aggr + 0.05) intent = xRel > 0.2 ? "reverse" : "sweep";
  else if (length === "Yorker") intent = rng() < 0.7 ? "defend" : "drive";
  else if (length === "Good") intent = rng() < 0.55 ? (xRel < -0.1 ? "flick" : "defend") : "drive";
  else intent = xRel < -0.12 ? "flick" : "drive";
  if (intent === "defend" && rng() < aggr * 0.35) intent = xRel < -0.1 ? "flick" : "drive";
  const loft = rng() < 0.2 * aggr;
  let relAz = 0, el = 8, bat = 24, front = true, stride = 0.55, yawDeg = 25;
  switch (intent) {
    case "drive": relAz = xRel > 0.3 ? between(rng, 30, 65) : between(rng, -10, 25); el = loft ? between(rng, 26, 40) : between(rng, 3, 14); bat = between(rng, 22, 30) * (0.8 + 0.2 * aggr); stride = between(rng, 0.45, 0.7); yawDeg = 30; break;
    case "defend": relAz = between(rng, -12, 12); el = between(rng, 0, 4); bat = 10; front = rng() < 0.7; stride = front ? between(rng, 0.4, 0.6) : 0.1; yawDeg = 10; break;
    case "cut": relAz = between(rng, 80, 135); el = between(rng, 3, 20); bat = between(rng, 22, 28); front = false; stride = 0.08; yawDeg = 45; break;
    case "pull": relAz = between(rng, -115, -50); el = loft ? between(rng, 24, 38) : between(rng, 8, 24); bat = between(rng, 24, 31); front = false; stride = 0.08; yawDeg = 70; break;
    case "flick": relAz = between(rng, -80, -35); el = between(rng, 2, 16); bat = between(rng, 20, 27); stride = between(rng, 0.35, 0.6); yawDeg = 50; break;
    case "sweep": relAz = between(rng, -150, -110); el = between(rng, 6, 26); bat = between(rng, 20, 26); stride = 0.5; yawDeg = 70; break;
    case "reverse": relAz = between(rng, 110, 150); el = between(rng, 6, 24); bat = between(rng, 20, 26); stride = 0.5; yawDeg = 60; break;
    default: break;
  }
  return { intent, relAz, el, bat, front, stride, yawDeg };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

/** Variation-disguise score: how closely each delivery's release height / arm speed match the stock baseline (0-100%). */
export function applyDisguiseScores(balls: BallRecord[]) {
  const withB = balls.filter((b) => b.bowling);
  if (withB.length < 3) return;
  const h = median(withB.map((b) => b.bowling!.releaseHeightM));
  const a = median(withB.map((b) => b.bowling!.armSpeedMs));
  for (const b of withB) {
    const dh = Math.abs(b.bowling!.releaseHeightM - h) / 0.08;
    const da = Math.abs(b.bowling!.armSpeedMs - a) / Math.max(0.1, 0.15 * a);
    b.bowling!.disguiseScore = Math.round(100 * (1 - clamp(0.5 * dh + 0.5 * da, 0, 1)));
  }
}

/* ------------------------------------------- one ball ------------------------------------------- */

export function simulateBall(ctx: Ctx): SimBall {
  const { cfg, rng, field } = ctx;
  const os = offSign(cfg.handedness);
  const spec = cfg.surface;
  const { bp, arm, variation, spin } = bowlingPlan(ctx);
  const bowlerFrames = generateBowler(bp);
  const bx = extractBowling(bowlerFrames, { arm });
  const bio: BowlingBiomech | null = bx ? bx.biomech : null;
  const rel: Vec3 = { x: bio ? bio.releaseXm : bp.releaseX, y: BOWLER_CREASE_Y + 0.45 + bp.overCm / 100, z: bio ? bio.releaseHeightM : 2.05 };
  const tgt = chooseTarget(ctx, spin, variation, rel.x);
  const style = cfg.bowlerStyle;
  const flip = arm === "L" ? -1 : 1;
  const speedMs = spin
    ? between(rng, 23, 28) * (variation ? 0.88 : 1)
    : (between(rng, 34, 41) + 0.5 * ((bio?.runUpSpeedMs ?? 6.8) - 6.8)) * (variation ? 0.85 : 1);
  const dspec: DeliverySpec = {
    release: rel, speedMs, bounce: tgt,
    backRpm: spin ? 700 : 900,
    turnRpm: style === "Off-Spin" ? -1500 * flip - between(rng, 0, 400) : style === "Leg-Spin" ? 1400 * flip + between(rng, 0, 400) : 0,
    driftRpm: style === "Off-Spin" ? -450 * flip : style === "Leg-Spin" ? 450 * flip : 0,
    swingAccel: spin ? 0 : (cfg.surface === "Green/Seam" ? 2.6 : cfg.surface === "Astro-Turf" ? 0.8 : 1.4) * between(rng, -2, 2.2),
    seamDir: between(rng, -1, 1),
    surface: spec,
  };
  const flight = simulateDelivery(dspec, cfg.handedness);
  const bounce = flight.bounce;
  const yFromBatter = bounce ? PITCH_LENGTH - bounce.p.y : null;
  const length = yFromBatter !== null ? classifyLength(yFromBatter) : null;
  const line = bounce ? classifyLine(bounce.p.x, cfg.handedness) : null;

  /* ---------- batter ---------- */
  const plan = battingPlan(ctx, flight, length, line, spin);
  const swing = plan.intent !== "leave";
  const P = swing ? (plan.front ? between(rng, 0.66, 0.9) : between(rng, 0.15, 0.38)) : 0.5;
  const strideM = swing ? plan.stride : 0.05;
  const fatigue = ctx.index / Math.max(1, ctx.total);
  const headDrift = gauss(rng) * 2.5 + (1 - ctx.skill) * between(rng, 0, 9) * (rng() < 0.5 ? 1 : -1) + 4 * fatigue;
  const frontY = BATTER_CREASE_Y + 0.15 - 0.3 - strideM;
  const yIdeal = lerp(BATTER_CREASE_Y + 0.1, frontY - 0.1, P);
  const tIdeal = timeAtY(flight, yIdeal) ?? (flight.atStumps?.t ?? 0.6);
  const sigma = 0.011 + (1 - ctx.skill) * 0.02 + (spin ? 0.004 : 0) + 0.004 * fatigue;
  const dT = gauss(rng) * sigma;
  const tC = tIdeal + dT;
  const sC = stateAtT(flight, tC);
  const errM = yIdeal - sC.p.y;
  const lat = gauss(rng) * (0.022 + (1 - ctx.skill) * 0.03);
  const reach = plan.intent === "pull" ? 1.9 : 1.55;
  let contact = swing && Math.abs(lat) <= 0.11 && sC.p.z >= 0.04 && sC.p.z <= reach && Math.abs(errM) < 1.0;
  const edge = contact && Math.abs(lat) > 0.05;
  const tTrig = Math.min(0.14 + rng() * 0.12, tC - 0.22);
  const bat = defaultBatter({
    hand: cfg.handedness, impactT: tC, triggerT: Math.max(0.05, tTrig), strideM, frontFootPct: P * 100, headDriftCm: headDrift * 1,
    backliftDeg: 28 + gauss(rng) * 4, swingPlaneDeg: 30 + gauss(rng) * 3, elbowPoleDeg: 40 + gauss(rng) * 6, swing, shotYawDeg: plan.yawDeg,
  });
  const batterFrames = generateBatter(bat);
  const bx2 = extractBatting(batterFrames, { hand: cfg.handedness, impactT: tC });
  let batBio: BattingBiomech | null = bx2 ? bx2.biomech : null;
  if (batBio && !swing) batBio = { ...batBio, swingDetected: false };

  /* ---------- extras & pad ---------- */
  let padFirst = false;
  let padT = 0;
  if (!contact) {
    const sp = stateAtY(flight, BATTER_CREASE_Y + 0.1);
    if (sp && sp.p.z < 0.5 && Math.abs(sp.p.x - 0.05 * os) < 0.24) { padFirst = true; padT = sp.t; }
  }
  const verdictExtras = judgeExtras(flight, bio, cfg, { bouncersThisOver: ctx.score.bouncersThisOver }, contact);
  const freeHit = ctx.score.freeHit;
  const notes: string[] = [];
  let runs = 0, extraRuns = 0;
  let extra: ExtraKind = null;
  let wicket: DismissalKind = null;
  let boundary: 4 | 6 | null = null;
  let timing: TimingClass = classifyTiming({ errM, edge, contact, padFirst });
  let shot: ShotType | null = null;
  let ballistics: ShotBallistics | null = null;
  let shotRes: ShotResult | null = null;
  let contactPos: Vec3 | null = null;
  let lbw: BallOutcome["lbw"];
  let fielderId: string | undefined;
  let wagon: WagonPoint | undefined;
  const wideMissed = verdictExtras.wide;

  const resolve = (res: FieldResolution) => res;
  const isNoBall = verdictExtras.noBall;
  if (isNoBall) notes.push(`No-ball: ${verdictExtras.noBallReason}`);
  if (wideMissed) notes.push(`Wide: ${verdictExtras.notes.join(", ")}`);
  const dismissalsVoid = freeHit || isNoBall;

  if (contact) {
    const vIn = sC.v;
    let ex;
    if (edge) {
      ex = edgeExit(vIn, os === 1 ? -1 : 1 as -1 | 1, rng);
      notes.push("Edged");
    } else {
      const eff = clamp(1 - Math.abs(errM) * 0.9 - Math.abs(lat) * 3, 0.35, 1);
      const relAz = plan.relAz - clamp(errM * 40, -35, 35);
      const az = wrap360(relAz * os);
      const el = clamp(plan.el + Math.abs(errM) * 12 * (rng() < 0.5 ? 1 : 0), -2, 55);
      ex = batExit({ vIn, azimuthDeg: az, elevationDeg: el, batSpeedMs: plan.bat, efficiency: eff });
    }
    contactPos = { ...sC.p };
    ballistics = { exitSpeedKph: toKph(ex.speedMs), horizontalAngleDeg: ex.azimuthDeg, elevationDeg: ex.elevationDeg, backspinRpm: ex.backspinRpm };
    shotRes = simulateShot({
      from: contactPos, exitSpeedMs: ex.speedMs, azimuthDeg: ex.azimuthDeg, elevationDeg: ex.elevationDeg,
      backspinRpm: ex.backspinRpm, outfield: cfg.outfield, boundaryRadius: cfg.boundaryRadius,
    });
    const fr = resolve(resolveFielding(shotRes, field, { allowCatch: !dismissalsVoid, outfield: cfg.outfield }));
    fielderId = fr.fielderId;
    notes.push(fr.note);
    if (fr.kind === "caught") { wicket = "caught"; runs = 0; }
    else { runs = fr.runs; boundary = fr.boundary; }
    shot = classifyShot({
      azimuthDeg: ex.azimuthDeg, elevationDeg: ex.elevationDeg, exitSpeedMs: ex.speedMs, hand: cfg.handedness,
      length: length ?? "Full", frontFootPct: batBio?.frontFootPct ?? P * 100, spin, contact: true, swingDetected: true,
    });
    const end = shotRes.crossing?.p ?? shotRes.rest?.p ?? shotRes.samples[shotRes.samples.length - 1].p;
    wagon = { azimuthDeg: ex.azimuthDeg, runs: boundary ?? runs, boundary, distance: Math.hypot(end.x - contactPos.x, end.y - contactPos.y) };
    if (wideMissed) { /* struck: cannot be wide */ }
  } else if (padFirst) {
    lbw = lbwVerdict({ flight, hand: cfg.handedness, padT, shotOffered: swing, batFirst: false });
    notes.push(`LBW review: ${lbw.reason}`);
    shot = swing ? classifyShot({ azimuthDeg: 0, elevationDeg: 0, exitSpeedMs: 0, hand: cfg.handedness, length: length ?? "Full", frontFootPct: P * 100, spin, contact: false, swingDetected: true }) : "Leave";
    if (lbw.decision === "OUT" && !dismissalsVoid) wicket = "lbw";
    else if (rng() < 0.35 && !wideMissed) { extra = "legbye"; extraRuns = 1; }
  } else {
    shot = swing ? classifyShot({ azimuthDeg: 0, elevationDeg: 0, exitSpeedMs: 0, hand: cfg.handedness, length: length ?? "Full", frontFootPct: P * 100, spin, contact: false, swingDetected: true }) : "Leave";
    if (isBowled(flight)) {
      if (!dismissalsVoid) { wicket = "bowled"; timing = "Pad/Miss"; } else notes.push("Hit the stumps but the dismissal is void");
    } else if (flight.atStumps) {
      // beaten – keeper collects; runs are byes (or wides)
      const a = flight.atStumps;
      const sp = Math.hypot(a.v.x, a.v.y, a.v.z) * 0.8;
      const az = wrap360((Math.atan2(a.v.x, -a.v.y) * 180) / Math.PI);
      const keep = resolveFielding(
        simulateShot({ from: { x: a.p.x, y: PITCH_LENGTH, z: Math.max(0.2, a.p.z) }, exitSpeedMs: sp, azimuthDeg: az, elevationDeg: 0, backspinRpm: 0, outfield: cfg.outfield, boundaryRadius: cfg.boundaryRadius }),
        field, { allowCatch: false, outfield: cfg.outfield },
      );
      const r = keep.runs;
      if (wideMissed) { extra = "wide"; extraRuns = 1 + r; }
      else if (r > 0) { extra = "bye"; extraRuns = r; }
    }
  }

  // extras that decide legality
  let legal = true;
  if (isNoBall) { extra = "noball"; legal = false; extraRuns += 1; wicket = null; }
  else if (wideMissed && !contact) {
    extra = "wide"; legal = false; wicket = wicket === "bowled" || wicket === "lbw" ? null : wicket;
    if (extraRuns === 0) extraRuns = 1;
  }
  if (extra === "wide" || extra === "noball") { /* runs off the bat only count for a no-ball */ if (extra === "wide") runs = 0; }
  if (freeHit && (wicket === "bowled" || wicket === "lbw" || wicket === "caught")) wicket = null;
  if (wicket) { runs = wicket === "caught" ? 0 : 0; boundary = null; }

  const outcome: BallOutcome = {
    runs, extraRuns, extra, legal, wicket, boundary, freeHitNext: isNoBall || cfg.format === "Net Free-Hit",
    notes, lbw, shotPath: shotRes?.samples.filter((_, i) => i % 3 === 0).map((s) => s.p), fielderId,
  };

  const flags: string[] = [];
  if (bio) {
    if (bio.frontFootOverCreaseCm > 0) flags.push("No-ball: front foot over crease");
    if (bio.backFootOutsideReturnCm > 0) flags.push("No-ball: return crease");
    if (bio.elbowFlag) flags.push("Elbow extension > 15°");
    if (!bio.kneeBraced) flags.push("Collapsed front knee");
    if (bio.counterRotationFlag) flags.push("Counter-rotation > 30°");
    if (bio.backFootStability < 60) flags.push("Unstable back-foot landing");
  }
  if (batBio && swing) {
    if (Math.abs(batBio.headDriftCm) > 8) flags.push("Head drift > 8 cm");
    if (batBio.triggerMs < 270) flags.push("Late trigger movement");
    if (contact && batBio.bottomHandPct > 62) flags.push("Bottom-hand dominant");
  }
  if (boundary) flags.push(`Boundary ${boundary}`);
  if (wicket) flags.push(`Wicket: ${wicket}`);
  if (extra === "wide") flags.push("Wide");
  if (edge) flags.push("Edge");

  const mode = cfg.mode;
  const record: BallRecord = {
    id: `b${ctx.index + 1}`,
    index: ctx.index + 1,
    over: Math.floor(ctx.score.legalBalls / 6),
    ballInOver: (ctx.score.legalBalls % 6) + 1,
    timeMs: ctx.startedAt + ctx.index * 28000,
    length, line,
    bounceYFromBatter: yFromBatter, bounceX: bounce ? bounce.p.x : null,
    speedKph: flight.releaseSpeedKph, bounceSpeedKph: flight.bounceSpeedKph || null,
    swingCm: flight.swingCm, turnDeg: flight.postBounceTurnDeg, bounceHeightCm: flight.bounceHeightAtStumpsCm,
    stumpArrival: flight.atStumps ? { x: flight.atStumps.p.x, z: flight.atStumps.p.z } : null,
    bowling: mode === "Batting Focus" ? null : bio,
    batting: mode === "Bowling Focus" ? null : batBio,
    timing, shot, ballistics, outcome, flags, clipId: null, synthetic: true,
  };
  void pick;
  return { record, flight, shot: shotRes, bowlerFrames, batterFrames, contactT: contact ? tC : null, contactPos };
}

export interface SimSession { balls: SimBall[]; score: ScoreState; field: FieldPlayer[] }

export function simulateSession(o: SimOptions): SimSession {
  const rng = mulberry32(o.seed);
  const field = buildField(o.cfg, o.fieldPreset ?? defaultFieldPreset(o.cfg));
  let score = newScore(o.cfg.format);
  const balls: SimBall[] = [];
  for (let i = 0; i < o.balls && !score.inningsOver; i++) {
    const b = simulateBall({ cfg: o.cfg, field, rng, score, index: i, total: o.balls, skill: o.batterSkill ?? 0.65, startedAt: o.startedAt ?? Date.now() });
    const wag = b.record.outcome.boundary || b.record.outcome.runs || b.shot ? undefined : undefined;
    void wag;
    score = applyOutcome(score, b.record.outcome, b.shot && b.contactPos ? {
      azimuthDeg: b.record.ballistics!.horizontalAngleDeg, runs: b.record.outcome.boundary ?? b.record.outcome.runs, boundary: b.record.outcome.boundary,
      distance: Math.hypot((b.shot.crossing?.p ?? b.shot.rest?.p ?? b.shot.samples[b.shot.samples.length - 1].p).x - b.contactPos.x, (b.shot.crossing?.p ?? b.shot.rest?.p ?? b.shot.samples[b.shot.samples.length - 1].p).y - b.contactPos.y),
    } : undefined);
    if (b.record.outcome.legal && b.record.ballInOver === 6) score.bouncersThisOver = 0;
    if (b.record.length === "Short" && b.flight.atStumps && b.flight.atStumps.p.z > o.cfg.batterShoulder) score.bouncersThisOver += 1;
    balls.push(b);
  }
  applyDisguiseScores(balls.map((b) => b.record));
  void mean;
  return { balls, score, field };
}
