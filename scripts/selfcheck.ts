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

import { createOnsetCore } from "../lib/audio/onset-core";
import { FrameRing } from "../lib/cv/frame-ring";
import { offlineReport, offlineLiveTip } from "../lib/coach/offline";
{
  const sr = 48000, N = sr * 2;
  const sig = (kind: "click" | "pad", at: number) => {
    const x = new Float32Array(N);
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
    for (let i = 0; i < N; i++) x[i] = rnd() * 0.004;
    for (let i = 0; i < 4000 && at + i < N; i++) {
      const t = i / sr;
      x[at + i] += kind === "click" ? 0.5 * Math.sin(2 * Math.PI * 3500 * t) * Math.exp(-t / 0.0015) : 0.5 * Math.sin(2 * Math.PI * 400 * t) * Math.exp(-t / 0.02) + 0.06 * Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-t / 0.01);
    }
    return x;
  };
  for (const kind of ["click", "pad"] as const) {
    const at = Math.round(0.8137 * sr), core = createOnsetCore(sr), evs = [];
    const x = sig(kind, at);
    for (let i = 0; i < N; i += 128) evs.push(...core.process(x.subarray(i, i + 128)));
    const e = evs[0];
    console.log("audio", kind, e ? `err ${(((e.onsetSample - at) / sr) * 1000).toFixed(3)} ms kind ${e.kind} peak ${e.peak.toFixed(2)} ratio ${e.ratio.toFixed(2)} decay ${e.decayMs.toFixed(1)}ms n=${evs.length}` : "NO EVENT");
  }
  const ring = new FrameRing<number>(5);
  for (let i = 0; i < 9; i++) ring.push(i * 0.01, i);
  console.log("ring len", ring.length, "oldest", ring.oldest()?.item, "nearest(.055)", ring.nearest(0.055)?.item, "range", ring.range(0.05, 0.07).map((f) => f.item).join(","));
  const sim = simulateSession({ cfg, balls: 12, seed: 3 });
  const sum = { id: "s", startedAt: 0, endedAt: 1, config: cfg, balls: sim.balls.map((b) => b.record), runs: sim.score.runs, wickets: sim.score.wickets, legalBalls: sim.score.legalBalls };
  const rep = offlineReport(sum);
  console.log("offline report:", rep.headline, "| right", rep.whatWentRight.length, "wrong", rep.whatWentWrong.length, "drills", rep.drills.length);
  console.log("tip:", offlineLiveTip(sim.balls[0].record));
}
