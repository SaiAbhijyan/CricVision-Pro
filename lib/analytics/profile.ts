/**
 * Player DNA: what the app learns about one player across many sessions.
 *
 * Everything here is a pure function of stored BallRecords, so it can run in the browser from IndexedDB, in tests, or on
 * any exported JSON. Nothing is sent anywhere. Thin data is never dressed up: every profile carries a `confidence`
 * (0..1) that grows with the number of shots / deliveries behind it, and the archetype is withheld below a minimum.
 */
import type { BallRecord, Handedness, SessionConfig } from "@/lib/types";

export interface SessionLike { id: string; startedAt: number; config: SessionConfig; balls: BallRecord[] }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = avg(xs); return Math.sqrt(avg(xs.map((x) => (x - m) ** 2))); };
const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** least-squares slope per step of an evenly-indexed series */
export function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = avg(ys);
  let sxy = 0, sxx = 0;
  ys.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) ** 2; });
  return sxx ? sxy / sxx : 0;
}

/* ------------------------------------------------------------------ batting */

export const ZONES = ["Straight", "Cover", "Point", "Third man", "Behind", "Fine leg", "Square leg", "Midwicket"] as const;
export type Zone = (typeof ZONES)[number];

/** Shot azimuth (world, clockwise from straight) to a batter-relative zone name. Left-handers are mirrored. */
export function zoneOf(azimuthDeg: number, hand: Handedness): Zone {
  const rel = hand === "RHB" ? azimuthDeg : (360 - azimuthDeg) % 360;
  const k = Math.floor((((rel + 22.5) % 360) + 360) % 360 / 45);
  return ZONES[k];
}

export type Archetype = "Anchor" | "Accumulator" | "Touch Player" | "Aggressor" | "Power Hitter" | "Building profile";

const ARCHETYPE_TEXT: Record<Archetype, string> = {
  "Anchor": "Plays the long game: many dots absorbed, few risks, built around staying in.",
  "Accumulator": "Rotates the strike and collects steady runs without needing the boundary.",
  "Touch Player": "Middles the ball a lot and places it, with timing rather than force.",
  "Aggressor": "Looks to score off most balls and carries a high strike rate.",
  "Power Hitter": "Boundary-first: clears the rope and hits hard, accepting some risk.",
  "Building profile": "Not enough shots yet to name a style: keep playing sessions.",
};

export interface BatterSessionPoint {
  sessionId: string; startedAt: number; shots: number; strikeRate: number; sweetPct: number; headDriftAbsCm: number;
  batSpeedKph: number; frontFootPct: number; dotPct: number;
}

export interface BatterDNA {
  sessions: number; balls: number; shots: number; confidence: number;
  strikeRate: number; boundaryPct: number; dotPct: number; controlPct: number; avgExitKph: number;
  aggression: number;           // 0..100
  consistency: number;          // 0..100, higher = repeatable technique
  archetype: Archetype; archetypeText: string;
  footwork: { frontFootPct: number; label: "Front-foot player" | "Back-foot player" | "Balanced" };
  zones: { zone: Zone; runs: number; share: number; shots: number }[];
  byLength: { length: string; shots: number; sweetPct: number; strikeRate: number; dismissals: number }[];
  vsPaceSpin: { kind: "Pace" | "Spin"; balls: number; strikeRate: number; sweetPct: number; dismissals: number }[];
  signatureShots: { shot: string; shots: number; runs: number }[];
  technique: {
    headDriftCm: { mean: number; sd: number }; triggerMs: { mean: number; sd: number }; strideCm: { mean: number; sd: number };
    batSpeedKph: { mean: number; sd: number }; attackAngleDeg: { mean: number; sd: number }; swingPathDeg: { mean: number; sd: number };
    downswingMs: { mean: number; sd: number };
  };
  trend: { points: BatterSessionPoint[]; sweetSlopePerSession: number; headDriftSlopePerSession: number; label: "Improving" | "Steady" | "Declining" | "Not enough sessions" };
  strengths: string[]; weaknesses: string[];
}

const isPace = (c: SessionConfig) => c.bowlerStyle === "Right Arm Pace" || c.bowlerStyle === "Left Arm Pace";
const m_sd = (xs: number[]) => ({ mean: avg(xs), sd: sd(xs) });

export function batterDNA(sessions: SessionLike[]): BatterDNA {
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  type Row = { b: BallRecord; hand: Handedness; pace: boolean };
  const rows: Row[] = ordered.flatMap((s) => s.balls.filter((b) => b.batting || b.ballistics).map((b) => ({ b, hand: s.config.handedness, pace: isPace(s.config) })));
  const faced = rows.filter((r) => r.b.outcome.legal);
  const shots = rows.filter((r) => r.b.shot && r.b.shot !== "Leave" && r.b.batting?.swingDetected !== false);
  const runs = faced.reduce((s, r) => s + r.b.outcome.runs, 0);
  const sweet = shots.filter((r) => r.b.timing === "Middle / Sweet Spot").length;
  const boundaries = faced.filter((r) => r.b.outcome.boundary).length;
  const dots = faced.filter((r) => r.b.outcome.runs + r.b.outcome.extraRuns === 0).length;
  const strikeRate = pct(runs, faced.length);
  const boundaryPct = pct(boundaries, faced.length), dotPct = pct(dots, faced.length), controlPct = pct(sweet, shots.length);
  const exits = shots.map((r) => r.b.ballistics?.exitSpeedKph ?? 0).filter(Boolean);
  const bats = shots.map((r) => r.b.batting!).filter(Boolean);
  const confidence = clamp(shots.length / 60, 0, 1);

  const shotRate = pct(shots.length, faced.length);
  const aggression = clamp(0.35 * clamp(strikeRate / 1.8, 0, 100) + 0.35 * clamp(boundaryPct * 3.5, 0, 100) + 0.3 * shotRate, 0, 100);

  let archetype: Archetype = "Building profile";
  if (shots.length >= 12) {
    const score: Record<Exclude<Archetype, "Building profile">, number> = {
      "Power Hitter": (boundaryPct >= 20 ? 2 : 0) + (avg(exits) >= 105 ? 1 : 0) + (strikeRate >= 130 ? 1 : 0),
      "Aggressor": (strikeRate >= 120 ? 2 : 0) + (dotPct <= 35 ? 1 : 0) + (shotRate >= 75 ? 1 : 0),
      "Touch Player": (controlPct >= 55 ? 2 : 0) + (boundaryPct < 18 ? 1 : 0) + (strikeRate >= 80 && strikeRate < 130 ? 1 : 0),
      "Accumulator": (dotPct <= 40 ? 1 : 0) + (boundaryPct < 14 ? 1 : 0) + (strikeRate >= 80 && strikeRate < 125 ? 2 : 0),
      "Anchor": (dotPct >= 42 ? 2 : 0) + (strikeRate < 100 ? 1 : 0) + (shotRate < 65 ? 1 : 0),
    };
    archetype = (Object.entries(score).sort((a, b) => b[1] - a[1])[0][0]) as Archetype;
  }

  const ff = avg(bats.map((b) => b.frontFootPct));
  const footLabel = ff >= 58 ? "Front-foot player" : ff <= 42 ? "Back-foot player" : "Balanced";

  const zoneRows = ZONES.map((zone) => {
    const z = faced.filter((r) => r.b.ballistics && zoneOf(r.b.ballistics.horizontalAngleDeg, r.hand) === zone);
    return { zone, runs: z.reduce((s, r) => s + r.b.outcome.runs, 0), shots: z.length };
  });
  const totalZoneRuns = zoneRows.reduce((s, z) => s + z.runs, 0);
  const zones = zoneRows.map((z) => ({ ...z, share: pct(z.runs, totalZoneRuns) }));

  const byLength = (["Yorker", "Full", "Good", "Short"] as const).map((length) => {
    const f = faced.filter((r) => r.b.length === length);
    const sh = shots.filter((r) => r.b.length === length);
    return {
      length, shots: sh.length, sweetPct: pct(sh.filter((r) => r.b.timing === "Middle / Sweet Spot").length, sh.length),
      strikeRate: pct(f.reduce((s, r) => s + r.b.outcome.runs, 0), f.length), dismissals: f.filter((r) => r.b.outcome.wicket).length,
    };
  });
  const vsPaceSpin = ([true, false] as const).map((pace) => {
    const f = faced.filter((r) => r.pace === pace), sh = shots.filter((r) => r.pace === pace);
    return {
      kind: pace ? "Pace" as const : "Spin" as const, balls: f.length, strikeRate: pct(f.reduce((s, r) => s + r.b.outcome.runs, 0), f.length),
      sweetPct: pct(sh.filter((r) => r.b.timing === "Middle / Sweet Spot").length, sh.length), dismissals: f.filter((r) => r.b.outcome.wicket).length,
    };
  });

  const shotMap = new Map<string, { shots: number; runs: number }>();
  for (const r of shots) { const k = r.b.shot!; const e = shotMap.get(k) ?? { shots: 0, runs: 0 }; e.shots++; e.runs += r.b.outcome.runs; shotMap.set(k, e); }
  const signatureShots = [...shotMap.entries()].map(([shot, v]) => ({ shot, ...v })).sort((a, b) => b.runs - a.runs).slice(0, 3);

  const technique = {
    headDriftCm: m_sd(bats.map((b) => Math.abs(b.headDriftCm))),
    triggerMs: m_sd(bats.map((b) => b.triggerMs)),
    strideCm: m_sd(bats.map((b) => b.strideCm)),
    batSpeedKph: m_sd(bats.map((b) => b.batSpeedKph).filter((v) => v > 5)),
    attackAngleDeg: m_sd(bats.map((b) => b.attackAngleDeg)),
    swingPathDeg: m_sd(bats.map((b) => b.swingPathDeg)),
    downswingMs: m_sd(bats.map((b) => b.downswingMs).filter((v) => v > 50)),
  };
  // consistency: tight head, trigger and stride relative to their means
  const cv = (x: { mean: number; sd: number }, floor: number) => x.sd / Math.max(floor, Math.abs(x.mean));
  const consistency = clamp(100 - 45 * cv(technique.headDriftCm, 3) - 60 * cv(technique.triggerMs, 150) - 40 * cv(technique.strideCm, 30), 0, 100);

  const points: BatterSessionPoint[] = ordered.map((s) => {
    const rs = s.balls.filter((b) => b.batting || b.ballistics);
    const fc = rs.filter((b) => b.outcome.legal);
    const sh = rs.filter((b) => b.shot && b.shot !== "Leave");
    const bt = rs.map((b) => b.batting).filter((x): x is NonNullable<typeof x> => !!x && x.swingDetected);
    return {
      sessionId: s.id, startedAt: s.startedAt, shots: sh.length,
      strikeRate: pct(fc.reduce((a, b) => a + b.outcome.runs, 0), fc.length),
      sweetPct: pct(sh.filter((b) => b.timing === "Middle / Sweet Spot").length, sh.length),
      headDriftAbsCm: avg(bt.map((b) => Math.abs(b.headDriftCm))),
      batSpeedKph: avg(bt.map((b) => b.batSpeedKph).filter((v) => v > 5)),
      frontFootPct: avg(bt.map((b) => b.frontFootPct)),
      dotPct: pct(fc.filter((b) => b.outcome.runs + b.outcome.extraRuns === 0).length, fc.length),
    };
  }).filter((p) => p.shots >= 3);
  const sweetSlope = slope(points.map((p) => p.sweetPct));
  const driftSlope = slope(points.map((p) => p.headDriftAbsCm));
  const label: BatterDNA["trend"]["label"] = points.length < 3 ? "Not enough sessions"
    : sweetSlope > 1.5 && driftSlope <= 0.3 ? "Improving" : sweetSlope < -1.5 || driftSlope > 0.8 ? "Declining" : "Steady";

  const strengths: string[] = [], weaknesses: string[] = [];
  if (shots.length >= 12) {
    const best = [...byLength].filter((l) => l.shots >= 4).sort((a, b) => b.sweetPct - a.sweetPct)[0];
    const worst = [...byLength].filter((l) => l.shots >= 4).sort((a, b) => a.sweetPct - b.sweetPct)[0];
    if (best) strengths.push(`Best timing against ${best.length.toLowerCase()} balls (${best.sweetPct.toFixed(0)}% middled).`);
    if (worst && worst !== best) weaknesses.push(`Struggles against ${worst.length.toLowerCase()} balls (${worst.sweetPct.toFixed(0)}% middled, ${worst.dismissals} dismissals).`);
    const topZone = [...zones].sort((a, b) => b.share - a.share)[0];
    if (topZone && topZone.runs > 0) strengths.push(`Scores most through ${topZone.zone} (${topZone.share.toFixed(0)}% of runs).`);
    const dead = zones.filter((z) => z.runs === 0 && ["Straight", "Cover", "Midwicket", "Square leg"].includes(z.zone));
    if (dead.length) weaknesses.push(`No runs through ${dead.map((z) => z.zone).join(", ")}: opposition can close those areas.`);
    const [pace, spin] = vsPaceSpin;
    if (pace.balls >= 8 && spin.balls >= 8 && Math.abs(pace.sweetPct - spin.sweetPct) > 12) {
      (pace.sweetPct > spin.sweetPct ? strengths : weaknesses).push(`Timing is ${Math.abs(pace.sweetPct - spin.sweetPct).toFixed(0)} points better against ${pace.sweetPct > spin.sweetPct ? "pace" : "spin"}.`);
    }
    if (technique.headDriftCm.mean > 7) weaknesses.push(`Head falls ${technique.headDriftCm.mean.toFixed(1)} cm off line on average: edges follow.`);
    else strengths.push(`Still head: ${technique.headDriftCm.mean.toFixed(1)} cm average drift.`);
    if (technique.triggerMs.mean < 270 && technique.triggerMs.mean > 0) weaknesses.push("Trigger movement starts late, leaving little time to adjust.");
  }

  return {
    sessions: ordered.length, balls: faced.length, shots: shots.length, confidence,
    strikeRate, boundaryPct, dotPct, controlPct, avgExitKph: avg(exits), aggression, consistency,
    archetype, archetypeText: ARCHETYPE_TEXT[archetype],
    footwork: { frontFootPct: ff, label: footLabel }, zones, byLength, vsPaceSpin, signatureShots, technique,
    trend: { points, sweetSlopePerSession: sweetSlope, headDriftSlopePerSession: driftSlope, label }, strengths, weaknesses,
  };
}

/* ------------------------------------------------------------------ bowling */

export interface BowlerSessionPoint { sessionId: string; startedAt: number; avgKph: number; accuracyPct: number; releaseSdCm: number; economy: number }

export interface BowlerDNA {
  sessions: number; deliveries: number; confidence: number;
  paceKph: { mean: number; sd: number; max: number };
  stockLength: string; stockLine: string; accuracyPct: number;
  airSwingCm: { mean: number; maxAbs: number; type: "Away swing" | "In swing" | "Little swing" };
  turnCm: { mean: number; maxAbs: number; type: "Turns away" | "Turns in" | "Little movement" };
  floatShiftM: number;
  releaseSdCm: { lateral: number; height: number };
  actionFlags: { elbowPct: number; kneeCollapsePct: number; overstepPct: number };
  fatigue: { paceDropKph: number; kneeDropDeg: number };
  variations: { slower: number; spread: number };
  economy: number; wicketBalls: number;
  trend: { points: BowlerSessionPoint[]; label: "Improving" | "Steady" | "Declining" | "Not enough sessions" };
  strengths: string[]; weaknesses: string[];
}

/** "Target channel": good/full length on or just outside off stump, the classic Test-match corridor. */
const inChannel = (b: BallRecord) => (b.length === "Good" || b.length === "Full") && (b.line === "Off Channel" || b.line === "Middle");

export function bowlerDNA(sessions: SessionLike[]): BowlerDNA {
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const balls = ordered.flatMap((s) => s.balls.filter((b) => b.speedKph));
  const legal = balls.filter((b) => b.outcome.legal);
  const kph = balls.map((b) => b.speedKph!);
  const mv = balls.map((b) => b.movement).filter((m): m is NonNullable<typeof m> => !!m);
  const air = mv.map((m) => m.airSwingMaxCm), turn = mv.map((m) => m.turnCm);
  const mode = <T,>(xs: T[]) => { const m = new Map<T, number>(); xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const bio = balls.map((b) => b.bowling).filter((x): x is NonNullable<typeof x> => !!x);
  const third = Math.max(1, Math.floor(balls.length / 3));
  const first = balls.slice(0, third), lastT = balls.slice(-third);
  const meanK = avg(kph);
  const accuracy = pct(balls.filter(inChannel).length, balls.length);

  const points: BowlerSessionPoint[] = ordered.map((s) => {
    const bs = s.balls.filter((b) => b.speedKph);
    const lg = bs.filter((b) => b.outcome.legal);
    const bi = bs.map((b) => b.bowling).filter((x): x is NonNullable<typeof x> => !!x);
    return {
      sessionId: s.id, startedAt: s.startedAt, avgKph: avg(bs.map((b) => b.speedKph!)), accuracyPct: pct(bs.filter(inChannel).length, bs.length),
      releaseSdCm: sd(bi.map((x) => x.releaseXm * 100)),
      economy: lg.length ? (lg.reduce((a, b) => a + b.outcome.runs + b.outcome.extraRuns, 0) * 6) / lg.length : 0,
    };
  }).filter((p) => p.avgKph > 0);
  const accSlope = slope(points.map((p) => p.accuracyPct)), ecoSlope = slope(points.map((p) => p.economy));
  const label: BowlerDNA["trend"]["label"] = points.length < 3 ? "Not enough sessions" : accSlope > 2 && ecoSlope <= 0.1 ? "Improving" : accSlope < -2 || ecoSlope > 0.4 ? "Declining" : "Steady";

  const airMean = avg(air), turnMean = avg(turn);
  const relSdLat = sd(bio.map((x) => x.releaseXm * 100)), relSdH = sd(bio.map((x) => x.releaseHeightM * 100));
  const out: BowlerDNA = {
    sessions: ordered.length, deliveries: balls.length, confidence: clamp(balls.length / 48, 0, 1),
    paceKph: { mean: meanK, sd: sd(kph), max: kph.length ? Math.max(...kph) : 0 },
    stockLength: mode(balls.map((b) => b.length).filter(Boolean)) ?? "-", stockLine: mode(balls.map((b) => b.line).filter(Boolean)) ?? "-", accuracyPct: accuracy,
    airSwingCm: { mean: airMean, maxAbs: Math.max(0, ...air.map(Math.abs)), type: Math.abs(airMean) < 3 ? "Little swing" : airMean > 0 ? "Away swing" : "In swing" },
    turnCm: { mean: turnMean, maxAbs: Math.max(0, ...turn.map(Math.abs)), type: Math.abs(turnMean) < 4 ? "Little movement" : turnMean > 0 ? "Turns away" : "Turns in" },
    floatShiftM: avg(mv.map((m) => m.pitchShiftM)),
    releaseSdCm: { lateral: relSdLat, height: relSdH },
    actionFlags: { elbowPct: pct(bio.filter((x) => x.elbowFlag).length, bio.length), kneeCollapsePct: pct(bio.filter((x) => !x.kneeBraced).length, bio.length), overstepPct: pct(bio.filter((x) => x.frontFootOverCreaseCm > 0).length, bio.length) },
    fatigue: { paceDropKph: avg(first.map((b) => b.speedKph!)) - avg(lastT.map((b) => b.speedKph!)), kneeDropDeg: avg(first.map((b) => b.bowling?.frontKneeBraceDeg ?? 0).filter(Boolean)) - avg(lastT.map((b) => b.bowling?.frontKneeBraceDeg ?? 0).filter(Boolean)) },
    variations: { slower: balls.filter((b) => b.speedKph! < meanK - 1.5 * sd(kph) && sd(kph) > 0).length, spread: pct(balls.filter((b) => b.speedKph! < meanK - 1.5 * sd(kph) && sd(kph) > 0).length, balls.length) },
    economy: legal.length ? (legal.reduce((a, b) => a + b.outcome.runs + b.outcome.extraRuns, 0) * 6) / legal.length : 0,
    wicketBalls: balls.filter((b) => b.outcome.wicket).length,
    trend: { points, label }, strengths: [], weaknesses: [],
  };
  if (balls.length >= 12) {
    if (accuracy >= 45) out.strengths.push(`${accuracy.toFixed(0)}% of balls land in the good-length off-stump channel.`); else out.weaknesses.push(`Only ${accuracy.toFixed(0)}% of balls reach the good-length off-stump channel.`);
    if (relSdLat < 3) out.strengths.push(`Repeatable action: release point varies only ${relSdLat.toFixed(1)} cm side to side.`); else if (relSdLat > 6) out.weaknesses.push(`Release point wanders ${relSdLat.toFixed(1)} cm side to side: batters can read variations early.`);
    if (out.airSwingCm.type !== "Little swing") out.strengths.push(`Consistent ${out.airSwingCm.type.toLowerCase()}: ${Math.abs(airMean).toFixed(0)} cm average against a normal ball.`);
    if (out.turnCm.type !== "Little movement") out.strengths.push(`Gets ${Math.abs(turnMean).toFixed(0)} cm average movement off the pitch (${out.turnCm.type.toLowerCase()}).`);
    if (out.fatigue.paceDropKph > 4) out.weaknesses.push(`Pace falls ${out.fatigue.paceDropKph.toFixed(1)} km/h from the first to the last third of the spell.`);
    if (out.actionFlags.elbowPct > 20) out.weaknesses.push(`Elbow extension flagged on ${out.actionFlags.elbowPct.toFixed(0)}% of balls.`);
    if (out.actionFlags.overstepPct > 5) out.weaknesses.push(`Overstepped on ${out.actionFlags.overstepPct.toFixed(0)}% of balls.`);
  }
  return out;
}
