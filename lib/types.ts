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
  /** how the real delivery differs from a plain (no swing, no spin) ball released identically */
  movement?: BallMovement;
}

/**
 * Movement versus the "normal delivery": the same release point, speed and launch angle flown with no seam swing and
 * no spin. Lateral numbers are signed from the batter's point of view: + = toward the off side (away from a
 * right-hander's body for RHB, mirrored for LHB).
 */
export interface BallMovement {
  /** sideways deviation in the air (swing + drift), measured at the pitching point, cm */
  airSwingCm: number;
  /** largest sideways deviation reached before the bounce, cm */
  airSwingMaxCm: number;
  /** extra sideways deviation gained off the pitch (spin / seam), cm: total at the stumps minus air swing */
  turnCm: number;
  /** total lateral difference at the stump plane, cm */
  totalMoveCm: number;
  /** distance (m) the ball pitched shorter (+) or fuller (-) than the plain ball: float / dip from spin */
  pitchShiftM: number;
  /** net off-the-pitch direction change, degrees (same sign convention as lateral numbers) */
  turnDeg: number;
  /** revolutions per minute at release, and the tilt of the spin axis from pure backspin (0) toward sidespin (90), degrees */
  spinRpm: number;
  spinAxisTiltDeg: number;
  swingType: "Away" | "In" | "Straight";
  turnType: "Away" | "In" | "Straight";
  /** ~40-point paths (x,y,z m) for drawing the real delivery against the plain one */
  actual: { x: number; y: number; z: number }[];
  baseline: { x: number; y: number; z: number }[];
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
  /** elbow angle when the upper arm is horizontal, and at release (ICC measures the change between them), degrees */
  elbowHorizDeg: number;
  elbowReleaseDeg: number;
  /** angle of the shoulder-to-wrist line from vertical at release: 0 = over the top, 90 = round-arm */
  armSlotDeg: number;
  /** peak angular speed of the whole arm swinging about the shoulder, between arm horizontal and release, deg/s */
  armRotationDegS: number;
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
  /** estimated bat-head speed at contact (about 3x the hands' speed, a pendulum lever, plus wrist release over 0.65 m), km/h */
  batSpeedKph: number;
  /** vertical angle of the hands' path at contact: + = upward (lofting), - = downward */
  attackAngleDeg: number;
  /** horizontal direction of the hands' path at contact vs the line of the ball: + = across to leg, - = across to off */
  swingPathDeg: number;
  /** time from top of the backlift to contact, ms */
  downswingMs: number;
  /** length of the hands' path from top of backlift to contact, cm */
  swingArcCm: number;
  /** how far the hips travelled toward the bowler from stance to contact, cm */
  weightShiftCm: number;
  comShiftCm: number;              // whole-body centre of mass travel stance -> contact, + toward the bowler
  weightSeries: number[];          // % of weight on the front foot, 34 samples from -450 ms to +100 ms around contact
  /** when the hips were moving fastest, relative to contact, ms (negative = before contact) */
  hipPeakMs: number;
  /** when the hands were moving fastest, relative to contact, ms (near 0 = bat at full speed at contact) */
  handPeakMs: number;
  /** true when peak speed moved from the hips, to the shoulders, to the hands, in that order (an efficient kinetic chain) */
  chainOrdered: boolean;
  /** numbers the footage could not support (shown as "not measured", left out of averages): the weight split jumped
   *  around or left the feet, or the hands moved implausibly fast (wrong slow-motion factor, tracking error) */
  unmeasured?: ("weight" | "batSpeed")[];
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
  /** metres between where the ball pitched and where it hit the pad; under 0.4 m the projection is flagged "extreme" as in Hawk-Eye */
  pitchToImpactM: number | null;
  impactToStumpsM: number | null;
  extreme: boolean;
  /** how far the ball centre is inside (+) or outside (-) the stump edge when it arrives, mm; 0 = grazing */
  stumpMarginMm: number | null;
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
  /** swing / spin compared with a normal delivery (null when no flight was solved) */
  movement: BallMovement | null;
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
  /** how well the video supported this analysis (live and uploaded clips only; absent for the simulator) */
  quality?: AnalysisQuality;
}

/** What the analysis saw, so the UI can say how far to trust each number. */
export interface AnalysisQuality {
  /** ball positions tracked before contact */
  trackPoints: number;
  /** RMS pixel error of the 3-D flight fit (lower is better) */
  fitRmsPx: number;
  /** where the contact time came from */
  contact: "audio" | "manual" | "none";
  /** frames in which a bowler / batter skeleton was found */
  bowlerPoseFrames: number;
  batterPoseFrames: number;
  /** 1-sigma uncertainty of the speed (km/h) from the flight fit; absent when not computed */
  speedSigmaKph?: number;
  /** 0..1 overall trust in the flight numbers (speed, line, length, swing) */
  confidence: number;
  /** plain-language reasons for any reduction in confidence */
  warnings: string[];
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

export interface ClipComFrame {
  c: { x: number; y: number };        // centre of mass, image space
  g: { x: number; y: number };        // point on the ground directly below it
  back: { x: number; y: number };     // back-foot ground contact
  front: { x: number; y: number };    // front-foot ground contact
  pct: number;                        // % of weight on the front foot
  fwd: number;                        // m/s toward the bowler
  seg: { x: number; y: number; w: number }[]; // segment centres, w = mass fraction
  side: ClipSideView;                 // the same body seen from the side, in metres
}

/** Side-on view: y = metres along the pitch (batter at ~20 m, bowler at 0), z = height. */
export interface ClipSideView {
  j: number[];    // 19 joints as y,z pairs, in JOINTS order
  seg: number[];  // 14 segment centres as y,z,massFraction triples
  c: [number, number]; // centre of mass y,z
  b: number; f: number; // back / front foot ground contact, y
}

export interface ClipOverlayFrame {
  t: number;
  com?: ClipComFrame | null;
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
