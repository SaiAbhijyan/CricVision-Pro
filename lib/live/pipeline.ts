/**
 * Live delivery assembly: turns what the camera + microphone observed (2-D ball track, bowler / batter skeletons, audio impact)
 * into the same BallRecord the simulator produces, so the scoreboard, charts and report treat both paths identically.
 *
 * Monocular approximations (documented in the README): the 3-D flight is recovered by fitting the aerodynamic model to the
 * pixel track (lib/physics/trackfit.ts); the post-impact exit direction comes from ground-plane unprojection of the track,
 * and exit elevation is inferred from the apparent ground speed (a lofted ball looks faster on the ground plane).
 */
import type { BallRecord, BattingBiomech, BowlingBiomech, CameraModel, DismissalKind, ExtraKind, FieldPlayer, SessionConfig, ShotBallistics, Vec3 } from "@/lib/types";
import { BATTER_CREASE_Y, PITCH_LENGTH, clamp, lerp, toKph } from "@/lib/physics/constants";
import { flightFromState, simulateShot } from "@/lib/physics/ballistics";
import { fitFlightTo2D } from "@/lib/physics/trackfit";
import { unprojectAtHeight } from "@/lib/physics/homography";
import { extractBatting, extractBowling } from "@/lib/cv/biomech";
import type { Skeleton } from "@/lib/cv/skeleton";
import { resolveFielding } from "@/lib/rules/field";
import { classifyLength, classifyLine, isBowled, judgeExtras, lbwVerdict, offSign, stateAtT } from "@/lib/rules/umpire";
import { classifyShot, classifyTiming } from "@/lib/rules/shot";
import type { ScoreState, WagonPoint } from "@/lib/rules/scoreboard";
import type { ImpactEvent } from "@/lib/audio/transient";

export interface TrackPt { t: number; x: number; y: number }   // t = performance seconds, x/y = full-resolution pixels
export interface LiveBallInput {
  cfg: SessionConfig; cam: CameraModel; field: FieldPlayer[]; score: ScoreState; index: number; startedAt: number;
  bowlerFrames: Skeleton[]; batterFrames: Skeleton[]; track: TrackPt[]; impact: ImpactEvent | null;
}
export interface LiveBallResult { record: BallRecord; wagon?: WagonPoint }

export function buildLiveBall(i: LiveBallInput): LiveBallResult | null {
  const { cfg, cam, field, score } = i;
  const os = offSign(cfg.handedness);
  const spin = cfg.bowlerStyle === "Off-Spin" || cfg.bowlerStyle === "Leg-Spin";
  const imp = i.impact;
  const t0 = i.track[0]?.t ?? 0;
  const pre = i.track.filter((p) => !imp || p.t < imp.tPerf - 0.002);
  if (pre.length < 5) return null;
  const fit = fitFlightTo2D(cam, pre.map((p) => ({ t: p.t - t0, px: { x: p.x, y: p.y } })), cfg.surface);
  if (!fit) return null;
  const flight = flightFromState({ p: fit.release, v: fit.velocity, w: { x: 0, y: 0, z: 0 } }, { surface: cfg.surface, swingAccel: 0, seamDir: 0 }, fit.release, fit.speedMs, cfg.handedness);
  const bounce = flight.bounce;
  const length = bounce ? classifyLength(PITCH_LENGTH - bounce.p.y) : null;
  const line = bounce ? classifyLine(bounce.p.x, cfg.handedness) : null;

  const arm = cfg.bowlerStyle === "Left Arm Pace" ? "L" : cfg.bowlerStyle === "Right Arm Pace" ? "R" : cfg.bowlerArm;
  const bx = i.bowlerFrames.length ? extractBowling(i.bowlerFrames, { arm }) : null;
  const bio: BowlingBiomech | null = cfg.mode === "Batting Focus" ? null : bx?.biomech ?? null;

  // Is the audio impact a real bat/pad contact? It must coincide with the ball being near the batter.
  let sC = imp ? stateAtT(flight, imp.tPerf - t0) : null;
  if (sC && !(sC.p.y > 16.5 && sC.p.y < 21.8 && sC.p.z < 2.3)) sC = null;
  const contact = !!sC && !!imp && imp.kind !== "pad-body";
  const padFirst = !!sC && !!imp && imp.kind === "pad-body";
  const edge = contact && imp!.kind === "bat-edge";

  const bt = imp && sC && i.batterFrames.length ? extractBatting(i.batterFrames, { hand: cfg.handedness, impactT: imp.tPerf }) : null;
  const batBio: BattingBiomech | null = cfg.mode === "Bowling Focus" ? null : bt?.biomech ?? null;

  let errM = 0;
  if (sC && batBio) {
    const P = batBio.frontFootPct / 100, stride = batBio.strideCm / 100;
    const yIdeal = lerp(BATTER_CREASE_Y + 0.1, BATTER_CREASE_Y + 0.15 - 0.3 - stride - 0.1, P);
    errM = yIdeal - sC.p.y;
  }
  const timing = sC ? classifyTiming({ errM, edge, contact, padFirst }) : null;

  const ex = judgeExtras(flight, bio, cfg, { bouncersThisOver: score.bouncersThisOver }, contact);
  const freeHit = score.freeHit, void_ = freeHit || ex.noBall;
  const notes: string[] = [];
  let runs = 0, extraRuns = 0, extra: ExtraKind = null, wicket: DismissalKind = null, boundary: 4 | 6 | null = null;
  let ballistics: ShotBallistics | null = null, shotPath: Vec3[] | undefined, wagon: WagonPoint | undefined, lbw: ReturnType<typeof lbwVerdict> | undefined, shot: BallRecord["shot"] = null;

  if (contact && sC) {
    const post = i.track.filter((p) => p.t > imp!.tPerf && p.t < imp!.tPerf + 0.2);
    let az = 0, spd = 22, el = 8;
    if (post.length >= 2) {
      const a = unprojectAtHeight(cam, post[0], 0.8), b = unprojectAtHeight(cam, post[post.length - 1], 0.8), dt = post[post.length - 1].t - post[0].t;
      if (a && b && dt > 0.004) {
        const dx = b.x - a.x, dy = b.y - a.y;
        az = (Math.atan2(dx, -dy) * 180) / Math.PI; if (az < 0) az += 360;
        const app = Math.hypot(dx, dy) / dt;
        spd = clamp(app, 8, 45); el = app > 38 ? Math.min(40, 12 + (app - 38) * 2) : 8;
      }
    }
    ballistics = { exitSpeedKph: toKph(spd), horizontalAngleDeg: az, elevationDeg: el, backspinRpm: 0 };
    const sr = simulateShot({ from: { ...sC.p }, exitSpeedMs: spd, azimuthDeg: az, elevationDeg: el, backspinRpm: 0, outfield: cfg.outfield, boundaryRadius: cfg.boundaryRadius });
    const fr = resolveFielding(sr, field, { allowCatch: !void_, outfield: cfg.outfield });
    notes.push(fr.note);
    if (fr.kind === "caught") wicket = "caught"; else { runs = fr.runs; boundary = fr.boundary; }
    shotPath = sr.samples.filter((_, k) => k % 3 === 0).map((s) => s.p);
    shot = classifyShot({ azimuthDeg: az, elevationDeg: el, exitSpeedMs: spd, hand: cfg.handedness, length: length ?? "Full", frontFootPct: batBio?.frontFootPct ?? 50, spin, contact: true, swingDetected: true });
    const end = sr.crossing?.p ?? sr.rest?.p ?? sr.samples[sr.samples.length - 1].p;
    wagon = { azimuthDeg: az, runs: boundary ?? runs, boundary, distance: Math.hypot(end.x - sC.p.x, end.y - sC.p.y) };
  } else if (padFirst && sC) {
    lbw = lbwVerdict({ flight, hand: cfg.handedness, padT: imp!.tPerf - t0, shotOffered: !!batBio?.swingDetected, batFirst: false });
    notes.push(`LBW review: ${lbw.reason}`);
    if (lbw.decision === "OUT" && !void_) wicket = "lbw";
  } else if (isBowled(flight)) {
    if (!void_) wicket = "bowled"; else notes.push("Hit the stumps but the dismissal is void");
  }
  let legal = true;
  if (ex.noBall) { extra = "noball"; legal = false; extraRuns += 1; wicket = null; notes.push(`No-ball: ${ex.noBallReason}`); }
  else if (ex.wide && !contact) { extra = "wide"; legal = false; extraRuns = 1; runs = 0; if (wicket === "bowled" || wicket === "lbw") wicket = null; }
  if (freeHit && wicket) wicket = null;
  if (wicket) { runs = 0; boundary = null; }

  const flags: string[] = [];
  if (bio) {
    if (bio.frontFootOverCreaseCm > 0) flags.push("No-ball: front foot over crease");
    if (bio.elbowFlag) flags.push("Elbow extension > 15°");
    if (!bio.kneeBraced) flags.push("Collapsed front knee");
    if (bio.counterRotationFlag) flags.push("Counter-rotation > 30°");
  }
  if (batBio?.swingDetected && Math.abs(batBio.headDriftCm) > 8) flags.push("Head drift > 8 cm");
  if (boundary) flags.push(`Boundary ${boundary}`);
  if (wicket) flags.push(`Wicket: ${wicket}`);

  const record: BallRecord = {
    id: `b${i.index + 1}`, index: i.index + 1, over: Math.floor(score.legalBalls / 6), ballInOver: (score.legalBalls % 6) + 1, timeMs: i.startedAt,
    length, line, bounceYFromBatter: bounce ? PITCH_LENGTH - bounce.p.y : null, bounceX: bounce ? bounce.p.x : null,
    speedKph: flight.releaseSpeedKph, bounceSpeedKph: flight.bounceSpeedKph || null, swingCm: flight.swingCm, turnDeg: flight.postBounceTurnDeg,
    bounceHeightCm: flight.bounceHeightAtStumpsCm, stumpArrival: flight.atStumps ? { x: flight.atStumps.p.x * os * os, z: flight.atStumps.p.z } : null,
    bowling: bio, batting: batBio, timing, shot, ballistics,
    outcome: { runs, extraRuns, extra, legal, wicket, boundary, freeHitNext: ex.noBall || cfg.format === "Net Free-Hit", notes, lbw, shotPath, fielderId: undefined },
    flags, clipId: null, synthetic: false,
  };
  return { record, wagon };
}
