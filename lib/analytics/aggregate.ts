import { weightOk, batSpeedOk } from "@/lib/cv/biomech";
import type { BallRecord, LengthClass, LineClass } from "@/lib/types";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);

export interface BatPoint { ball: number; frontFoot: number; headDrift: number; stride: number; backlift: number; wrist: number; exitKph: number | null; swing: boolean }
export const batSeries = (balls: BallRecord[]): BatPoint[] =>
  balls.filter((b) => weightOk(b.batting)).map((b) => ({
    ball: b.index, frontFoot: b.batting!.frontFootPct, headDrift: b.batting!.headDriftCm, stride: b.batting!.strideCm,
    backlift: b.batting!.backliftDeg, wrist: b.batting!.wristSnapDegS, exitKph: b.ballistics?.exitSpeedKph ?? null, swing: b.batting!.swingDetected,
  }));

export const LENGTHS: LengthClass[] = ["Yorker", "Full", "Good", "Short"];
export const LINES: LineClass[] = ["Wide Leg", "Leg", "Middle", "Off Channel", "Wide Off"];

export function timingByLength(balls: BallRecord[]) {
  return LENGTHS.map((len) => {
    const bs = balls.filter((b) => b.length === len && b.timing && b.shot !== "Leave");
    const n = bs.length;
    const c = (t: string) => bs.filter((b) => b.timing === t).length;
    return {
      length: len, n,
      sweet: pct(c("Middle / Sweet Spot"), n), early: pct(c("Early"), n), late: pct(c("Late"), n),
      edge: pct(c("Edge"), n), miss: pct(c("Pad/Miss"), n),
    };
  });
}

export function zoneHeat(balls: BallRecord[]) {
  return LENGTHS.flatMap((len) => LINES.map((line) => {
    const bs = balls.filter((b) => b.length === len && b.line === line);
    return { length: len, line, balls: bs.length, runs: bs.reduce((s, b) => s + b.outcome.runs, 0), wickets: bs.filter((b) => b.outcome.wicket).length };
  }));
}

export const wagon = (balls: BallRecord[]) =>
  balls.filter((b) => b.ballistics).map((b) => ({
    ball: b.index, az: b.ballistics!.horizontalAngleDeg, runs: b.outcome.boundary ?? b.outcome.runs, boundary: b.outcome.boundary,
    wicket: !!b.outcome.wicket, shot: b.shot, exit: b.ballistics!.exitSpeedKph,
  }));

export const beehive = (balls: BallRecord[]) =>
  balls.filter((b) => b.stumpArrival).map((b) => ({
    ball: b.index, x: b.stumpArrival!.x, z: b.stumpArrival!.z, kph: b.speedKph ?? 0,
    dot: b.outcome.runs === 0 && !b.outcome.wicket && b.outcome.legal, wicket: !!b.outcome.wicket,
  }));

export const pitchMap = (balls: BallRecord[]) =>
  balls.filter((b) => b.bounceX !== null && b.bounceYFromBatter !== null).map((b) => ({
    ball: b.index, x: b.bounceX!, yFromBatter: b.bounceYFromBatter!, kph: b.speedKph ?? 0, runs: b.outcome.runs,
    wicket: !!b.outcome.wicket, dot: b.outcome.runs === 0 && !b.outcome.wicket,
  }));

export const releaseSlots = (balls: BallRecord[]) =>
  balls.filter((b) => b.bowling).map((b) => ({ ball: b.index, x: b.bowling!.releaseXm, z: b.bowling!.releaseHeightM, disguise: b.bowling!.disguiseScore }));

export const stressCurve = (balls: BallRecord[]) =>
  balls.filter((b) => b.bowling).map((b) => ({
    ball: b.index, knee: b.bowling!.frontKneeBraceDeg, elbow: b.bowling!.elbowExtensionDeg,
    counter: b.bowling!.counterRotationDeg, xFactor: b.bowling!.hipShoulderSepDeg, kph: b.speedKph ?? 0,
  }));

export function sessionStats(balls: BallRecord[]) {
  const legal = balls.filter((b) => b.outcome.legal);
  const bat = balls.filter((b) => b.ballistics);
  const runs = balls.reduce((s, b) => s + b.outcome.runs + b.outcome.extraRuns, 0);
  return {
    balls: balls.length, legal: legal.length, runs,
    wickets: balls.filter((b) => b.outcome.wicket).length,
    boundaries: balls.filter((b) => b.outcome.boundary).length,
    dotPct: pct(legal.filter((b) => b.outcome.runs + b.outcome.extraRuns === 0).length, legal.length),
    noBalls: balls.filter((b) => b.outcome.extra === "noball").length,
    wides: balls.filter((b) => b.outcome.extra === "wide").length,
    avgKph: avg(balls.map((b) => b.speedKph ?? 0).filter(Boolean)),
    avgExitKph: avg(bat.map((b) => b.ballistics!.exitSpeedKph)),
    sweetPct: pct(balls.filter((b) => b.timing === "Middle / Sweet Spot").length, balls.filter((b) => b.shot && b.shot !== "Leave").length),
    economy: legal.length ? (runs * 6) / legal.length : 0,
  };
}

/** Pearson correlation helper used for the root-cause narratives. */
export function corr(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = avg(xs.slice(0, n)), my = avg(ys.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
