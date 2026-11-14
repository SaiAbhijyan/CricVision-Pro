import type { BallRecord, CoachReport, SessionSummary } from "@/lib/types";
import { batSeries, corr, sessionStats, timingByLength } from "@/lib/analytics/aggregate";

/** One-sentence rule-based cue — used when offline, rate-limited, or the model misses the 1.5 s budget. */
export function offlineLiveTip(b: BallRecord): string {
  const bo = b.bowling, ba = b.batting;
  if (bo) {
    if (bo.frontFootOverCreaseCm > 0) return `No-ball: your front foot landed ${Math.round(bo.frontFootOverCreaseCm)} centimetres over the crease, start your run-up a step shorter.`;
    if (bo.backFootOutsideReturnCm > 0) return "Back foot clipped outside the return crease, aim your run-up at the stumps.";
    if (bo.elbowFlag) return "Elbow is straightening too much at release, keep the arm firm through the delivery.";
    if (!bo.kneeBraced) return "Front knee is collapsing on landing, brace the leg to keep your pace.";
    if (bo.counterRotationFlag) return "Too much shoulder counter-rotation, stay side-on longer to protect your back.";
  }
  if (ba && ba.swingDetected) {
    if (Math.abs(ba.headDriftCm) > 8) return "Your head is falling over toward the off side, keep it still over the front knee.";
    if (b.timing === "Early") return "You are hitting it early, wait and let the ball come to you.";
    if (b.timing === "Late") return "You are late on the ball, start the downswing sooner.";
    if (b.timing === "Edge") return "Edged, get your head and front foot closer to the line of the ball.";
    if (ba.bottomHandPct > 62) return "Bottom hand is taking over, lead with the top hand for control.";
  }
  if (b.outcome.boundary) return `Beautifully timed for ${b.outcome.boundary}, repeat that head position.`;
  if (b.outcome.wicket) return "Wicket down, reset your routine before the next ball.";
  return b.length === "Short" ? "Short ball, get inside the line early." : "Good ball, stay balanced and watch it onto the bat.";
}

/** Deterministic dossier built from the same statistics the charts use. */
export function offlineReport(s: SessionSummary): CoachReport {
  const st = sessionStats(s.balls);
  const bs = batSeries(s.balls).filter((p) => p.swing);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const right: string[] = [], wrong: CoachReport["whatWentWrong"] = [], risks: string[] = [];
  const tl = timingByLength(s.balls).filter((t) => t.n >= 2).sort((a, b) => b.sweet - a.sweet);
  if (tl.length) right.push(`Best timing against ${tl[0].length.toLowerCase()} balls: ${tl[0].sweet.toFixed(0)}% middled from ${tl[0].n} shots.`);
  if (st.boundaries) right.push(`${st.boundaries} boundaries, average exit speed ${st.avgExitKph.toFixed(0)} km/h.`);
  if (st.dotPct && st.dotPct < 40) right.push(`Kept dot balls down to ${st.dotPct.toFixed(0)}%.`);
  if (st.economy && st.economy < 7 && s.balls.some((b) => b.bowling)) right.push(`Economy of ${st.economy.toFixed(1)} per over.`);
  if (bs.length >= 3) {
    const drift = avg(bs.map((p) => Math.abs(p.headDrift)));
    const worst = [...bs].sort((a, b) => Math.abs(b.headDrift) - Math.abs(a.headDrift))[0];
    if (drift > 5) {
      const edges = s.balls.filter((b) => b.timing === "Edge" || b.timing === "Pad/Miss").length;
      wrong.push({ issue: "Head drifting off the line of the ball", rootCause: "Weight is not transferring over the front foot, so the head falls away as the bat comes through.", evidence: `Mean |head drift| ${drift.toFixed(1)} cm, worst ${worst.headDrift.toFixed(1)} cm on ball ${worst.ball}; ${edges} edges/misses.` });
    }
    const c = corr(bs.map((p) => p.stride), bs.map((p) => p.wrist));
    if (Math.abs(c) > 0.4) wrong.push({ issue: "Footwork and wrist speed are coupled", rootCause: c < 0 ? "Long strides cost bat speed: the hands arrive after the feet have stopped." : "Wrist speed rises only with long strides, so short-stride shots lack power.", evidence: `Stride-vs-wrist correlation r=${c.toFixed(2)} over ${bs.length} swings.` });
  }
  const late = s.balls.filter((b) => b.timing === "Late" || b.timing === "Early");
  if (late.length >= 3) wrong.push({ issue: "Inconsistent timing", rootCause: "Trigger movement starts too close to ball arrival.", evidence: `${late.length} early/late contacts of ${s.balls.filter((b) => b.shot && b.shot !== "Leave").length} shots.` });
  const bw = s.balls.filter((b) => b.bowling).map((b) => b.bowling!);
  if (bw.length) {
    const no = bw.filter((b) => b.frontFootOverCreaseCm > 0).length;
    if (no) wrong.push({ issue: "Front-foot no-balls", rootCause: "Run-up length drifts as fatigue builds, so the landing point creeps forward.", evidence: `${no} of ${bw.length} deliveries overstepped.` });
    const knee = bw.filter((b) => !b.kneeBraced).length;
    if (knee) { wrong.push({ issue: "Collapsing front knee", rootCause: "Eccentric quad strength fades through the spell, so energy leaks at landing.", evidence: `${knee} deliveries below 165° brace.` }); risks.push("Repeated front-knee flexion at landing raises patellar and ACL load."); }
    const cr = bw.filter((b) => b.counterRotationFlag).length;
    if (cr) risks.push(`Counter-rotation above 30° on ${cr} deliveries: lumbar stress-fracture risk.`);
    if (bw.some((b) => b.elbowFlag)) risks.push("Elbow extension above 15° flagged under MCC bowling-action law.");
  }
  if (!wrong.length) wrong.push({ issue: "No dominant fault detected", rootCause: "Biomechanics stayed inside tolerance.", evidence: `${s.balls.length} balls analysed.` });
  if (!right.length) right.push("Session completed with stable mechanics.");
  const drills = [
    { name: "Head-over-knee freeze drill", targets: "Head drift / weight transfer", instructions: "Underarm feeds; finish each shot and hold the pose for two seconds with the nose over the front knee.", reps: "4 sets × 10 balls" },
    { name: "Late-trigger gate drill", targets: "Timing", instructions: "Start the trigger when the ball is released, not after the bounce; use a cone gate 1 m in front of the stumps.", reps: "5 sets × 8 balls" },
    { name: bw.length ? "Run-up marker drill" : "Stride-and-snap drill", targets: bw.length ? "No-balls and landing consistency" : "Stride length vs wrist speed", instructions: bw.length ? "Chalk the popping crease and land your front heel on a 5 cm marker 10 times without looking down." : "Shadow-bat with a fixed 55 cm stride, accelerating the wrists late in the swing.", reps: "3 sets × 12" },
  ];
  return { source: "offline-rules", headline: `${s.runs}/${s.wickets} from ${s.legalBalls} balls: ${wrong[0].issue.toLowerCase()} is the main limiter.`, whatWentRight: right.slice(0, 5), whatWentWrong: wrong.slice(0, 5), drills, injuryRisks: risks };
}
