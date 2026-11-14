/**
 * Deterministic MCC-law adjudication from ball trajectories + biomechanics evidence.
 */
import type {
  BowlingBiomech, DeliveryFlight, Handedness, LbwVerdict, LengthClass, LineClass, SessionConfig, Vec3,
} from "@/lib/types";
import {
  BALL_RADIUS, BATTER_CREASE_Y, PITCH_LENGTH, STUMP_HALF, STUMP_HEIGHT, WIDE_HALF,
} from "@/lib/physics/constants";

export const offSign = (h: Handedness) => (h === "RHB" ? 1 : -1);

/** Length band measured from the batter's stumps: Yorker <2 m, Full 2–5, Good 5–8, Short >8. */
export function classifyLength(yFromBatter: number): LengthClass {
  if (yFromBatter < 2) return "Yorker";
  if (yFromBatter < 5) return "Full";
  if (yFromBatter < 8) return "Good";
  return "Short";
}

/** Line at the pitching point relative to the batter (off side positive). */
export function classifyLine(x: number, hand: Handedness): LineClass {
  const r = x * offSign(hand);
  if (r > 0.6) return "Wide Off";
  if (r > 0.15) return "Off Channel";
  if (r >= -0.15) return "Middle";
  if (r >= -0.6) return "Leg";
  return "Wide Leg";
}

/** Point of the (unobstructed) trajectory at plane y. */
export function stateAtY(flight: DeliveryFlight, y: number): { t: number; p: Vec3; v: Vec3 } | null {
  const s = flight.samples;
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1].p.y < y && s[i].p.y >= y) {
      const f = (y - s[i - 1].p.y) / ((s[i].p.y - s[i - 1].p.y) || 1e-9);
      const l = (a: number, b: number) => a + (b - a) * f;
      return {
        t: l(s[i - 1].t, s[i].t),
        p: { x: l(s[i - 1].p.x, s[i].p.x), y, z: l(s[i - 1].p.z, s[i].p.z) },
        v: { x: l(s[i - 1].v.x, s[i].v.x), y: l(s[i - 1].v.y, s[i].v.y), z: l(s[i - 1].v.z, s[i].v.z) },
      };
    }
  }
  return null;
}

/** Position of the ball at a given time along a trajectory. */
export function stateAtT(flight: DeliveryFlight, t: number): { p: Vec3; v: Vec3 } {
  const s = flight.samples;
  if (t <= s[0].t) return { p: s[0].p, v: s[0].v };
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const f = (t - s[i - 1].t) / ((s[i].t - s[i - 1].t) || 1e-9);
      const l = (a: number, b: number) => a + (b - a) * f;
      return {
        p: { x: l(s[i - 1].p.x, s[i].p.x), y: l(s[i - 1].p.y, s[i].p.y), z: l(s[i - 1].p.z, s[i].p.z) },
        v: { x: l(s[i - 1].v.x, s[i].v.x), y: l(s[i - 1].v.y, s[i].v.y), z: l(s[i - 1].v.z, s[i].v.z) },
      };
    }
  }
  const e = s[s.length - 1];
  return { p: e.p, v: e.v };
}

/** Time at which the unobstructed trajectory reaches plane y (null if never). */
export const timeAtY = (flight: DeliveryFlight, y: number) => stateAtY(flight, y)?.t ?? null;

/* ----------------------------------------- stumps ----------------------------------------- */

export type StumpResult = "Hitting" | "Umpire's Call" | "Missing";

/** DRS-style stump test at the batter's stump plane: ball centre within the stumps = Hitting; clipping the edge = Umpire's Call. */
export function stumpTest(p: { x: number; z: number } | null): StumpResult {
  if (!p) return "Missing";
  const top = STUMP_HEIGHT + 0.013; // bails
  const dx = Math.abs(p.x) - STUMP_HALF;
  const dz = p.z - top;
  if (p.z < -BALL_RADIUS) return "Missing";
  if (dx <= 0 && dz <= 0) return "Hitting";
  if (dx <= BALL_RADIUS && dz <= BALL_RADIUS) return "Umpire's Call";
  return "Missing";
}

export const isBowled = (flight: DeliveryFlight) => {
  const a = flight.atStumps;
  return !!a && stumpTest({ x: a.p.x, z: a.p.z }) === "Hitting";
};

/* ------------------------------------------ extras ------------------------------------------ */

export interface BouncerState { bouncersThisOver: number }

export interface ExtrasVerdict {
  wide: boolean;
  noBall: boolean;
  noBallReason: string | null;
  bouncer: boolean;
  notes: string[];
}

/**
 * Wides, no-balls (front foot, return crease, beamer, excessive bouncers).
 * `batterPlayed` suppresses a wide call (the ball was struck / the batter had a genuine attempt).
 */
export function judgeExtras(
  flight: DeliveryFlight, bio: BowlingBiomech | null, cfg: SessionConfig, st: BouncerState, batterPlayed: boolean,
): ExtrasVerdict {
  const notes: string[] = [];
  let noBall = false;
  let reason: string | null = null;
  if (bio) {
    if (bio.frontFootOverCreaseCm > 0) { noBall = true; reason = `front foot ${bio.frontFootOverCreaseCm.toFixed(0)} cm over the popping crease`; }
    else if (bio.backFootOutsideReturnCm > 0) { noBall = true; reason = `foot cut the return crease by ${bio.backFootOutsideReturnCm.toFixed(0)} cm`; }
  }
  const atCrease = stateAtY(flight, BATTER_CREASE_Y);
  const pitchedBeforeCrease = !!flight.bounce && flight.bounce.p.y < BATTER_CREASE_Y;
  // beamer: no bounce, above waist at the batter's popping crease
  if (!noBall && atCrease && !pitchedBeforeCrease && atCrease.p.z > cfg.batterWaist) {
    noBall = true; reason = `full toss above waist (${atCrease.p.z.toFixed(2)} m)`;
  }
  // bouncers: pitched ball over shoulder height at the batter's stumps
  const arr = flight.atStumps;
  let bouncer = false;
  if (arr && pitchedBeforeCrease && arr.p.z > cfg.batterShoulder) bouncer = true;
  const limit = cfg.format === "Net Free-Hit" ? 99 : 2;
  if (!noBall && bouncer && st.bouncersThisOver >= limit) { noBall = true; reason = `bouncer #${st.bouncersThisOver + 1} in the over`; }
  let wide = false;
  if (!batterPlayed && !noBall && arr) {
    if (Math.abs(arr.p.x) > WIDE_HALF) { wide = true; notes.push(`passed ${Math.abs(arr.p.x).toFixed(2)} m from middle stump`); }
    else if (pitchedBeforeCrease && arr.p.z > cfg.batterHead) { wide = true; notes.push(`over head height (${arr.p.z.toFixed(2)} m)`); }
  }
  if (!arr && !batterPlayed && !noBall) { wide = true; notes.push("did not reach the batter"); }
  return { wide, noBall, noBallReason: reason, bouncer, notes };
}

/* -------------------------------------------- LBW -------------------------------------------- */

export interface LbwInput {
  flight: DeliveryFlight;
  hand: Handedness;
  /** time and position at which the ball struck the pad (before any bat contact) */
  padT: number;
  shotOffered: boolean;
  batFirst: boolean;
}

/** Pitching / impact / wickets evaluation by projecting the post-impact path (the unobstructed trajectory) to the stumps. */
export function lbwVerdict(i: LbwInput): LbwVerdict {
  const os = offSign(i.hand);
  const f = i.flight;
  const pad = stateAtT(f, i.padT);
  const pitch = f.bounce ? f.bounce.p : null;
  const rel = (x: number) => x * os;
  const pitching: LbwVerdict["pitching"] =
    !pitch ? "In-Line" : rel(pitch.x) < -STUMP_HALF ? "Outside Leg" : rel(pitch.x) > STUMP_HALF ? "Outside Off" : "In-Line";
  const impact: LbwVerdict["impact"] =
    rel(pad.p.x) < -STUMP_HALF - BALL_RADIUS * 0.5 ? "Outside Leg" : rel(pad.p.x) > STUMP_HALF + BALL_RADIUS * 0.5 ? "Outside Off" : "In-Line";
  const a = f.atStumps;
  const proj = a ? { x: a.p.x, z: a.p.z } : null;
  const wickets = stumpTest(proj);
  let decision: LbwVerdict["decision"] = "NOT OUT";
  let reason = "";
  if (i.batFirst) reason = "Bat made contact first";
  else if (!pitch) reason = "Full toss – pitching not applicable, impact judged on line";
  if (i.batFirst) { /* not out */ }
  else if (pitching === "Outside Leg") reason = "Pitched outside leg stump";
  else if (impact === "Outside Leg") reason = "Impact outside leg stump";
  else if (impact === "Outside Off" && i.shotOffered) reason = "Impact outside off stump and a shot was offered";
  else if (wickets === "Missing") reason = "Ball would have missed the stumps";
  else if (wickets === "Umpire's Call") reason = "Umpire's Call – clipping the stumps, on-field decision stands (not out)";
  else { decision = "OUT"; reason = `Pitched ${pitching.toLowerCase()}, struck ${impact.toLowerCase()}, hitting the stumps`; }
  const pitchToImpact = pitch ? Math.abs(pad.p.y - pitch.y) : null;
  const toStumps = a ? Math.abs(PITCH_LENGTH - pad.p.y) : null;
  const margin = proj ? Math.min(STUMP_HALF - Math.abs(proj.x), STUMP_HEIGHT + 0.013 - proj.z) * 1000 : null;
  return { pitching, impact, wickets, decision, reason, projectedAtStumps: proj, pitchToImpactM: pitchToImpact, impactToStumpsM: toStumps, extreme: pitchToImpact !== null && pitchToImpact < 0.4, stumpMarginMm: margin };
}

export const PITCH_END = PITCH_LENGTH;
