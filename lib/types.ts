/**
 * Shared domain types.
 *
 * WORLD COORDINATES (metres) used everywhere:
 *   origin  = centre of the BOWLER'S stumps, on the ground
 *   +Y      = along the pitch toward the batter (batter's stumps at y = 20.12)
 *   +X      = to the RIGHT when standing at the batter's end looking toward the bowler
 *             (so a right-hand batter's off side is +X, a left-hand batter's off side is -X)
 *   +Z      = up
 * Shot direction angle theta: degrees clockwise from "straight back down the ground"
 * (toward the bowler, -Y) as seen from above with the bowler's end at the top of the screen.
 */

export type Handedness = "RHB" | "LHB";
export type BowlerStyle = "Right Arm Pace" | "Left Arm Pace" | "Off-Spin" | "Leg-Spin";
export type BowlerArm = "R" | "L";
export type BowlingAngle = "Over the Wicket" | "Round the Wicket";
export type ActiveMode = "Batting Focus" | "Bowling Focus" | "Full Match Duel (1v1)";
export type OutfieldSpeed = "Slow" | "Medium" | "Lightning";
export type PitchSurface = "Green/Seam" | "Dry/Dusty" | "Astro-Turf";
export type MatchFormat = "Net Free-Hit" | "Super Over" | "Powerplay Chase";

export interface SessionConfig {
  mode: ActiveMode;
  handedness: Handedness;
  bowlerStyle: BowlerStyle;
  bowlerArm: BowlerArm;
  bowlingAngle: BowlingAngle;
  boundaryRadius: number; // 55..80 m
  outfield: OutfieldSpeed;
  surface: PitchSurface;
  format: MatchFormat;
  /** Batter's standing waist / shoulder / head heights (m) used for no-ball / bouncer / wide-over-head rules. */
  batterWaist: number;
  batterShoulder: number;
  batterHead: number;
  /** Persisted calibration offset between audio clock and video clock (ms). */
  audioOffsetMs: number;
}

export interface Pt { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Calibration {
  /** Image-space (pixel) positions of the 4 pitch corners, order: bowler-left, bowler-right, batter-right, batter-left (as drawn on screen). */
  corners: [Pt, Pt, Pt, Pt];
  /** Image-space position of the top of the batter's middle stump (0.711 m). */
  stumpTop: Pt;
  imageWidth: number;
  imageHeight: number;
}

export interface CameraModel {
  /** ground(X,Y,0,1) -> image (homogeneous), row-major 3x3 */
  H: Mat3;
  Hinv: Mat3;
  f: number;       // focal length px
  cx: number;
  cy: number;
  R: number[];     // 3x3 row-major
  t: [number, number, number];
  reprojErrorPx: number;
  stumpTopErrorPx: number;
  imageWidth: number;
  imageHeight: number;
}

/* ---------------- Ball flight ---------------- */

export interface FlightSample { t: number; p: Vec3; v: Vec3; bounced: boolean }

export interface DeliveryFlight {
  samples: FlightSample[];
  bounce: { t: number; p: Vec3; vIn: Vec3; vOut: Vec3 } | null;
  /** state at the batter's stump plane (y = 20.12) if reached */
  atStumps: { t: number; p: Vec3; v: Vec3 } | null;
  releaseSpeedKph: number;
  bounceSpeedKph: number;
  swingCm: number;          // max lateral deviation from straight release->bounce chord (pre-bounce)
  postBounceTurnDeg: number; // signed, + toward off side (wrt handedness)
  bounceHeightAtStumpsCm: number;
}

export type LengthClass = "Yorker" | "Full" | "Good" | "Short";
export type LineClass = "Wide Off" | "Off Channel" | "Middle" | "Leg" | "Wide Leg";

/* ---------------- Biomechanics ---------------- */

export interface BowlingBiomech {
  runUpSpeedMs: number;
  backFootStability: number;       // 0..100 (lower lateral wobble => higher)
  frontStrideCm: number;
  frontFootOverCreaseCm: number;   // + = over (illegal), - = behind
  backFootOutsideReturnCm: number; // + = cutting/outside return crease
  elbowExtensionDeg: number;
  elbowFlag: boolean;
  frontKneeBraceDeg: number;       // at release
  frontKneeCollapseDeg: number;    // brace@FFC - brace@release (positive = collapsed)
  kneeBraced: boolean;
  hipShoulderSepDeg: number;       // X-factor max separation
  counterRotationDeg: number;
  counterRotationFlag: boolean;
  releaseHeightM: number;
  releaseLateralCm: number;        // distance of release point from the stump line
  releaseXm: number;
  wristSnapDegS: number;
  armSpeedMs: number;
  disguiseScore: number;           // 0..100
}

export interface BattingBiomech {
  frontFootPct: number;            // CoM weight on front foot at impact
  strideCm: number;
  triggerMs: number;               // trigger onset -> impact (ms)
  headDriftCm: number;             // lateral head drift stance -> impact
  backliftDeg: number;
  frontElbowDeg: number;
  bottomHandPct: number;           // bottom-hand dominance 0..100
  wristSnapDegS: number;
  swingPlaneDeg: number;
  swingDetected: boolean;
}

export type TimingClass = "Early" | "Middle / Sweet Spot" | "Late" | "Edge" | "Pad/Miss";
export type ShotType =
  | "Cover/Straight Drive" | "Cut" | "Pull/Hook" | "Sweep/Reverse" | "Flick"
  | "Forward/Back Defense" | "Leave";

export interface ShotBallistics {
  exitSpeedKph: number;
  horizontalAngleDeg: number; // 0..360 clockwise from straight
  elevationDeg: number;
  backspinRpm: number;        // + backspin, - topspin
}

/* ---------------- Rules / outcomes ---------------- */

export type ExtraKind = "wide" | "noball" | "bye" | "legbye" | null;
export type DismissalKind = "bowled" | "caught" | "lbw" | null;

export interface LbwVerdict {
  pitching: "In-Line" | "Outside Off" | "Outside Leg";
  impact: "In-Line" | "Outside Off" | "Outside Leg";
  wickets: "Hitting" | "Umpire's Call" | "Missing";
  decision: "OUT" | "NOT OUT";
  reason: string;
  projectedAtStumps: { x: number; z: number } | null;
}

export interface BallOutcome {
  runs: number;          // runs off the bat or byes etc. (excluding the extra penalty run)
  extraRuns: number;     // penalty (wide/no-ball = 1) + byes/leg-byes
  extra: ExtraKind;
  legal: boolean;
  wicket: DismissalKind;
  boundary: 4 | 6 | null;
  freeHitNext: boolean;
  notes: string[];
  lbw?: LbwVerdict;
  shotPath?: Vec3[];     // sampled shot trajectory for tracer / radar
  fielderId?: string;
}

export interface BallRecord {
  id: string;
  index: number;          // 1-based ball number in session
  over: number;           // 0-based completed overs before this ball
  ballInOver: number;     // 1-based legal-ball counter at time of delivery
  timeMs: number;
  length: LengthClass | null;
  line: LineClass | null;
  bounceYFromBatter: number | null; // m
  bounceX: number | null;
  speedKph: number | null;
  bounceSpeedKph: number | null;
  swingCm: number | null;
  turnDeg: number | null;
  bounceHeightCm: number | null;
  stumpArrival: { x: number; z: number } | null;
  bowling: BowlingBiomech | null;
  batting: BattingBiomech | null;
  timing: TimingClass | null;
  shot: ShotType | null;
  ballistics: ShotBallistics | null;
  outcome: BallOutcome;
  flags: string[];
  clipId: string | null;
  synthetic: boolean;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  config: SessionConfig;
  balls: BallRecord[];
  runs: number;
  wickets: number;
  legalBalls: number;
}

/* ---------------- AI coaching ---------------- */

export interface CoachReport {
  source: "gemini-4-carbon" | "offline-rules";
  headline: string;
  whatWentRight: string[];
  whatWentWrong: { issue: string; rootCause: string; evidence: string }[];
  drills: { name: string; targets: string; instructions: string; reps: string }[];
  injuryRisks: string[];
}

export interface FieldPlayer { id: string; label: string; x: number; y: number; keeper?: boolean }

export interface ClipOverlayFrame {
  t: number;
  landmarks?: { x: number; y: number; v?: number }[];
  ball?: { x: number; y: number } | null;
}

export interface ClipMeta {
  id: string;
  sessionId: string;
  ballIndex: number;
  reason: string;
  createdAt: number;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  overlays: ClipOverlayFrame[];
  tracer: { x: number; y: number }[]; // image-space ball tracer incl. shot arc projected
}
