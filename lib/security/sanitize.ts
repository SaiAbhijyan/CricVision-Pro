/**
 * Boundary validation for everything the browser sends to the coaching endpoints.
 *
 * The client is untrusted: a request can be forged, and free-text fields (flags, notes) are the classic route for
 * prompt injection into an LLM. So the server never forwards client JSON. It rebuilds a BallRecord / SessionSummary
 * from an allowlist: numbers are finite and clamped, strings must match known enums, and the few free-text strings that
 * remain (flags) are filtered to a safe character set and length.
 */
import type {
  BallRecord, BowlingBiomech, BattingBiomech, LengthClass, LineClass, SessionConfig, SessionSummary, ShotType, TimingClass,
} from "@/lib/types";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown, lo: number, hi: number): number | null => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null);
const numD = (x: unknown, lo: number, hi: number, d = 0) => num(x, lo, hi) ?? d;
const oneOf = <T extends string>(x: unknown, set: readonly T[]): T | null => (typeof x === "string" && (set as readonly string[]).includes(x) ? (x as T) : null);

export const LENGTHS = ["Yorker", "Full", "Good", "Short"] as const satisfies readonly LengthClass[];
export const LINES = ["Wide Off", "Off Channel", "Middle", "Leg", "Wide Leg"] as const satisfies readonly LineClass[];
export const TIMINGS = ["Early", "Middle / Sweet Spot", "Late", "Edge", "Pad/Miss"] as const satisfies readonly TimingClass[];
export const SHOTS = ["Cover/Straight Drive", "Cut", "Pull/Hook", "Sweep/Reverse", "Flick", "Forward/Back Defense", "Leave"] as const satisfies readonly ShotType[];
const EXTRAS = ["wide", "noball", "bye", "legbye"] as const;
const WICKETS = ["bowled", "caught", "lbw"] as const;

const MODES = ["Batting Focus", "Bowling Focus", "Full Match Duel (1v1)"] as const;
const STYLES = ["Right Arm Pace", "Left Arm Pace", "Off-Spin", "Leg-Spin"] as const;
const ANGLES = ["Over the Wicket", "Round the Wicket"] as const;
const OUTFIELDS = ["Slow", "Medium", "Lightning"] as const;
const SURFACES = ["Green/Seam", "Dry/Dusty", "Astro-Turf"] as const;
const FORMATS = ["Net Free-Hit", "Super Over", "Powerplay Chase"] as const;

/**
 * Flags are produced by the app's own rules, so the server accepts only those exact strings. A character filter cannot
 * stop plain-English prompt injection, an allowlist can: anything else a client puts in `flags` is dropped.
 */
const KNOWN_FLAGS = /^(?:Bottom-hand dominant|Collapsed front knee|Counter-rotation > 30°|Edge|Elbow extension > 15°|Head drift > 8 cm|Late trigger movement|No-ball: front foot over crease|No-ball: return crease|Unstable back-foot landing|Wide|Boundary [46]|Wicket: (?:bowled|caught|lbw))$/;

/** Letters, digits, spaces and a few punctuation marks only; no newlines, quotes, braces or markup. */
export const safeText = (x: unknown, max = 60): string | null => {
  if (typeof x !== "string") return null;
  const s = x.replace(/[^A-Za-z0-9 .,:%°/'()+\-–>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return s.length ? s : null;
};

export function sanitizeConfig(x: unknown): SessionConfig | null {
  if (!isObj(x)) return null;
  const mode = oneOf(x.mode, MODES), style = oneOf(x.bowlerStyle, STYLES), angle = oneOf(x.bowlingAngle, ANGLES);
  const out = oneOf(x.outfield, OUTFIELDS), surf = oneOf(x.surface, SURFACES), fmt = oneOf(x.format, FORMATS);
  const hand = oneOf(x.handedness, ["RHB", "LHB"] as const), arm = oneOf(x.bowlerArm, ["R", "L"] as const);
  if (!mode || !style || !angle || !out || !surf || !fmt || !hand || !arm) return null;
  return {
    mode, handedness: hand, bowlerStyle: style, bowlerArm: arm, bowlingAngle: angle, boundaryRadius: numD(x.boundaryRadius, 40, 100, 65),
    outfield: out, surface: surf, format: fmt, batterWaist: numD(x.batterWaist, 0.6, 1.4, 1), batterShoulder: numD(x.batterShoulder, 1, 1.9, 1.45),
    batterHead: numD(x.batterHead, 1.2, 2.2, 1.75), audioOffsetMs: numD(x.audioOffsetMs, -500, 500, 0),
  };
}

function bowling(x: unknown): BowlingBiomech | null {
  if (!isObj(x)) return null;
  const n = (k: string, lo: number, hi: number) => numD(x[k], lo, hi);
  return {
    runUpSpeedMs: n("runUpSpeedMs", 0, 15), backFootStability: n("backFootStability", 0, 100), frontStrideCm: n("frontStrideCm", 0, 400),
    frontFootOverCreaseCm: n("frontFootOverCreaseCm", -300, 300), backFootOutsideReturnCm: n("backFootOutsideReturnCm", -300, 300),
    elbowExtensionDeg: n("elbowExtensionDeg", 0, 90), elbowFlag: x.elbowFlag === true, elbowHorizDeg: n("elbowHorizDeg", 0, 200), elbowReleaseDeg: n("elbowReleaseDeg", 0, 200), armSlotDeg: n("armSlotDeg", 0, 180), armRotationDegS: n("armRotationDegS", 0, 5000), frontKneeBraceDeg: n("frontKneeBraceDeg", 0, 200),
    frontKneeCollapseDeg: n("frontKneeCollapseDeg", -90, 90), kneeBraced: x.kneeBraced === true, hipShoulderSepDeg: n("hipShoulderSepDeg", 0, 120),
    counterRotationDeg: n("counterRotationDeg", 0, 120), counterRotationFlag: x.counterRotationFlag === true, releaseHeightM: n("releaseHeightM", 0, 3),
    releaseLateralCm: n("releaseLateralCm", 0, 300), releaseXm: n("releaseXm", -3, 3), wristSnapDegS: n("wristSnapDegS", 0, 5000),
    armSpeedMs: n("armSpeedMs", 0, 60), disguiseScore: n("disguiseScore", 0, 100),
  };
}

function batting(x: unknown): BattingBiomech | null {
  if (!isObj(x)) return null;
  const n = (k: string, lo: number, hi: number) => numD(x[k], lo, hi);
  return {
    frontFootPct: n("frontFootPct", 0, 100), strideCm: n("strideCm", 0, 300), triggerMs: n("triggerMs", 0, 3000), headDriftCm: n("headDriftCm", -100, 100),
    backliftDeg: n("backliftDeg", 0, 180), frontElbowDeg: n("frontElbowDeg", -90, 180), bottomHandPct: n("bottomHandPct", 0, 100),
    wristSnapDegS: n("wristSnapDegS", 0, 5000), swingPlaneDeg: n("swingPlaneDeg", -90, 90), swingDetected: x.swingDetected === true,
    batSpeedKph: n("batSpeedKph", 0, 170), attackAngleDeg: n("attackAngleDeg", -60, 60), swingPathDeg: n("swingPathDeg", -90, 90),
    downswingMs: n("downswingMs", 0, 1500), swingArcCm: n("swingArcCm", 0, 400),
    weightShiftCm: n("weightShiftCm", 0, 300), hipPeakMs: n("hipPeakMs", -1500, 500), handPeakMs: n("handPeakMs", -1500, 500), chainOrdered: x.chainOrdered === true,
  };
}

export function sanitizeBall(x: unknown, fallbackIndex = 1): BallRecord | null {
  if (!isObj(x)) return null;
  const o = isObj(x.outcome) ? x.outcome : {};
  const ball = isObj(x.ballistics) ? x.ballistics : null;
  const mv = isObj(x.movement) ? x.movement : null;
  const flags = Array.isArray(x.flags) ? x.flags.slice(0, 16).filter((f): f is string => typeof f === "string" && KNOWN_FLAGS.test(f)) : [];
  const idx = Math.round(numD(x.index, 1, 100000, fallbackIndex));
  return {
    id: `b${idx}`, index: idx, over: Math.round(numD(x.over, 0, 10000)), ballInOver: Math.round(numD(x.ballInOver, 1, 6, 1)), timeMs: numD(x.timeMs, 0, 4e12),
    length: oneOf(x.length, LENGTHS), line: oneOf(x.line, LINES), bounceYFromBatter: num(x.bounceYFromBatter, -5, 30), bounceX: num(x.bounceX, -5, 5),
    speedKph: num(x.speedKph, 0, 220), bounceSpeedKph: num(x.bounceSpeedKph, 0, 220), swingCm: num(x.swingCm, 0, 500), turnDeg: num(x.turnDeg, -45, 45),
    movement: mv ? {
      airSwingCm: numD(mv.airSwingCm, -300, 300), airSwingMaxCm: numD(mv.airSwingMaxCm, -300, 300), turnCm: numD(mv.turnCm, -500, 500),
      totalMoveCm: numD(mv.totalMoveCm, -600, 600), pitchShiftM: numD(mv.pitchShiftM, -10, 10), turnDeg: numD(mv.turnDeg, -45, 45), spinRpm: numD(mv.spinRpm, 0, 6000), spinAxisTiltDeg: numD(mv.spinAxisTiltDeg, 0, 90),
      swingType: oneOf(mv.swingType, ["Away", "In", "Straight"] as const) ?? "Straight", turnType: oneOf(mv.turnType, ["Away", "In", "Straight"] as const) ?? "Straight",
      actual: [], baseline: [], // drawing paths are never needed server-side
    } : null,
    bounceHeightCm: num(x.bounceHeightCm, 0, 400),
    stumpArrival: isObj(x.stumpArrival) ? { x: numD(x.stumpArrival.x, -3, 3), z: numD(x.stumpArrival.z, -1, 4) } : null,
    bowling: bowling(x.bowling), batting: batting(x.batting), timing: oneOf(x.timing, TIMINGS), shot: oneOf(x.shot, SHOTS),
    ballistics: ball ? { exitSpeedKph: numD(ball.exitSpeedKph, 0, 250), horizontalAngleDeg: numD(ball.horizontalAngleDeg, 0, 360), elevationDeg: numD(ball.elevationDeg, -90, 90), backspinRpm: numD(ball.backspinRpm, -5000, 5000) } : null,
    outcome: {
      runs: Math.round(numD(o.runs, 0, 8)), extraRuns: Math.round(numD(o.extraRuns, 0, 8)), extra: oneOf(o.extra, EXTRAS), legal: o.legal !== false,
      wicket: oneOf(o.wicket, WICKETS), boundary: o.boundary === 4 || o.boundary === 6 ? o.boundary : null, freeHitNext: o.freeHitNext === true, notes: [],
    },
    flags, clipId: null, synthetic: x.synthetic === true,
  };
}

export const MAX_BALLS = 150;

export function sanitizeSession(x: unknown): SessionSummary | null {
  if (!isObj(x) || !Array.isArray(x.balls)) return null;
  const config = sanitizeConfig(x.config);
  if (!config) return null;
  const balls: BallRecord[] = [];
  for (const [i, b] of x.balls.slice(0, MAX_BALLS).entries()) { const s = sanitizeBall(b, i + 1); if (s) balls.push(s); }
  if (!balls.length) return null;
  return {
    id: "session", startedAt: numD(x.startedAt, 0, 4e12), endedAt: numD(x.endedAt, 0, 4e12), config, balls,
    runs: Math.round(numD(x.runs, 0, 5000)), wickets: Math.round(numD(x.wickets, 0, 10)), legalBalls: Math.round(numD(x.legalBalls, 0, 5000)),
  };
}
