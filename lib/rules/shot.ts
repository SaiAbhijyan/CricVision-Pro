import type { Handedness, LengthClass, ShotType, TimingClass } from "@/lib/types";
import { wrap180 } from "@/lib/physics/constants";
import { offSign } from "./umpire";

export interface TimingInput {
  /** metres the ball is from the ideal contact plane when struck (+ = ball still far out => early) */
  errM: number;
  edge: boolean;
  contact: boolean;
  padFirst: boolean;
}

/** Early / Middle(Sweet Spot) / Late / Edge / Pad-Miss from audio-synced contact position. */
export function classifyTiming(i: TimingInput): TimingClass {
  if (i.padFirst || !i.contact) return "Pad/Miss";
  if (i.edge) return "Edge";
  if (i.errM > 0.3) return "Early";
  if (i.errM < -0.3) return "Late";
  return "Middle / Sweet Spot";
}

export interface ShotClassInput {
  azimuthDeg: number;       // repo convention (0 = back down the ground), absolute
  elevationDeg: number;
  exitSpeedMs: number;
  hand: Handedness;
  length: LengthClass;
  frontFootPct: number;
  spin: boolean;
  contact: boolean;
  swingDetected: boolean;
}

/** Shot direction relative to the batter: 0 = straight, + = off side, range (-180, 180]. */
export function relativeAzimuth(azimuthDeg: number, hand: Handedness) {
  return wrap180(azimuthDeg * offSign(hand));
}

export function classifyShot(i: ShotClassInput): ShotType {
  if (!i.contact && !i.swingDetected) return "Leave";
  const rel = relativeAzimuth(i.azimuthDeg, i.hand);
  const back = i.frontFootPct < 50;
  if (i.contact && i.exitSpeedMs < 9 && Math.abs(rel) < 75) return "Forward/Back Defense";
  if (i.spin && (i.length === "Full" || i.length === "Good") && Math.abs(rel) > 100) return "Sweep/Reverse";
  if (rel >= -35 && rel <= 75) return i.length === "Short" && back && rel > 40 ? "Cut" : "Cover/Straight Drive";
  if (rel > 75) return "Cut";
  return i.length === "Short" || back ? "Pull/Hook" : "Flick";
}
