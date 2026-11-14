import { generateBowler, defaultBowler, generateBatter, defaultBatter } from "../lib/sim/synth-pose";
import { extractBowling, extractBatting } from "../lib/cv/biomech";

const f = (n: number, d = 1) => n.toFixed(d);
const bw = extractBowling(generateBowler(defaultBowler()), { arm: "R" });
console.log("bowl", bw && { ...Object.fromEntries(Object.entries(bw.biomech).map(([k, v]) => [k, typeof v === "number" ? +f(v, 2) : v])), ev: bw.events });
const bw2 = extractBowling(generateBowler(defaultBowler({ arm: "L", overCm: 6, elbowExtDeg: 20, counterRotDeg: 38, kneeRelDeg: 150, releaseX: -1.5 })), { arm: "L" });
console.log("bowl2", bw2 && { over: bw2.biomech.frontFootOverCreaseCm, out: bw2.biomech.backFootOutsideReturnCm, ext: bw2.biomech.elbowExtensionDeg, cr: bw2.biomech.counterRotationDeg, knee: bw2.biomech.frontKneeBraceDeg, relX: bw2.biomech.releaseXm });
const bt = extractBatting(generateBatter(defaultBatter()), { hand: "RHB", impactT: 0.55 });
console.log("bat", bt && Object.fromEntries(Object.entries(bt.biomech).map(([k, v]) => [k, typeof v === "number" ? +f(v, 1) : v])));
const bt2 = extractBatting(generateBatter(defaultBatter({ hand: "LHB", frontFootPct: 30, strideM: 0.1, headDriftCm: -9 })), { hand: "LHB", impactT: 0.55 });
console.log("batLHB", bt2 && { ff: bt2.biomech.frontFootPct, stride: bt2.biomech.strideCm, head: bt2.biomech.headDriftCm });

import { virtualCalibration } from "../lib/sim/virtual-camera";
import { buildCameraModel, project, pixelToGround } from "../lib/physics/homography";
const cal = virtualCalibration();
const cam = buildCameraModel(cal)!;
console.log("cam f", f(cam.f, 0), "(true", 0.95 * 1280, ") reproj", f(cam.reprojErrorPx, 3), "stumpTopErr", f(cam.stumpTopErrorPx, 2));
const pp = project(cam, { x: 1, y: 10, z: 1.5 })!; console.log("proj", pp, "ground", pixelToGround(cam, project(cam, { x: 1, y: 10, z: 0 })!));

import { simulateSession } from "../lib/sim/match-sim";
import type { SessionConfig } from "../lib/types";
const cfg: SessionConfig = { mode: "Full Match Duel (1v1)", handedness: "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket", boundaryRadius: 65, outfield: "Medium", surface: "Green/Seam", format: "Powerplay Chase", batterWaist: 1.0, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0 };
for (const style of ["Right Arm Pace", "Off-Spin"] as const) {
  const t0 = Date.now();
  const sim = simulateSession({ cfg: { ...cfg, bowlerStyle: style }, balls: 18, seed: 7 });
  console.log(style, "ms", Date.now() - t0, "score", sim.score.runs + "/" + sim.score.wickets, "legal", sim.score.legalBalls);
  for (const b of sim.balls.slice(0, 18)) { const r = b.record; console.log(r.index, r.speedKph?.toFixed(0), r.length, r.line, "swing", r.swingCm?.toFixed(0), "turn", r.turnDeg?.toFixed(1), "|", r.shot, r.timing, "|", r.outcome.extra ?? "", r.outcome.runs, r.outcome.wicket ?? "", r.outcome.boundary ?? "", r.flags.join(";")); }
}
