/**
 * Batting-only analysis (no calibration) of a real clip: pose landmarks from scripts/real-pose-frames.cjs, frames for cut
 * detection decoded with ffmpeg, then the app's own analyseClip(cal: null).
 * usage: npx tsx scripts/real-batting.ts <video> <fps> <statureM> <RHB|LHB> <pose1.json> [pose2.json ...]
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { analyseClip, type ClipSource } from "../lib/upload/analyse";
import { liftBodyScaled } from "../lib/cv/skeleton";
import type { SessionConfig } from "../lib/types";
const [video, fpsA, statA, hand, ...poseFiles] = process.argv.slice(2);
const fps = +fpsA, stature = +statA, GW = 160, GH = 90;
const frames = new Map<number, { lm: number[][] | null; wl: number[][] | null }>(); let W = 640, H = 360;
for (const f of poseFiles) { const d = JSON.parse(readFileSync(f, "utf8")); W = d.w; H = d.h; for (const fr of d.frames) frames.set(fr.k, fr); }
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `scale=${GW}:${GH},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 }).stdout;
const n = Math.floor(raw.length / (GW * GH));
const src: ClipSource = { width: W, height: H, analysisWidth: GW, fps, frameCount: n, frame: async (k, o) => {
  const t = k / fps, p = frames.get(k);
  const sk = o.pose && p?.lm && p.wl ? liftBodyScaled(p.lm.map((l) => ({ x: l[0], y: l[1] })), p.wl.map((l) => ({ x: l[0], y: l[1], z: l[2] })), t, W, H, stature) : null;
  return { t, gray: { w: GW, h: GH, data: new Uint8ClampedArray(raw.subarray(k * GW * GH, (k + 1) * GW * GH)) }, pose: o.pose ? { bowler: null, batter: sk, people: sk ? 1 : 0 } : undefined };
} };
const cfg: SessionConfig = { mode: "Batting Focus", handedness: hand as "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket", boundaryRadius: 65, outfield: "Medium", surface: "Green/Seam", format: "Net Free-Hit", batterWaist: 1, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0 };
(async () => {
  const times: number[] = [];
  const r = await analyseClip(src, { cfg, cal: null, impacts: [], poseStride: 1, onDelivery: (d) => { times.push(d.tEnd - 0.4); } });
  console.log("frames", n, "shots", r.shots.length, "swings", r.balls.length);
  for (const b of r.balls) {
    const x = b.batting!, q = b.quality!;
    console.log(`#${b.index} t=${times[b.index - 1]?.toFixed(2)}s bat ${x.unmeasured?.includes("batSpeed") ? "n/m" : x.batSpeedKph.toFixed(0) + " km/h"} | front ${x.unmeasured?.includes("weight") ? "n/m" : x.frontFootPct.toFixed(0) + "%"} | stride ${x.strideCm.toFixed(0)} cm | head drift ${x.headDriftCm.toFixed(1)} cm | downswing ${x.downswingMs.toFixed(0)} ms | backlift ${x.backliftDeg.toFixed(0)}° | path ${x.swingPathDeg.toFixed(0)}° | pose frames ${q.batterPoseFrames}${x.unmeasured?.includes("batSpeed") && x.downswingMs > 700 ? " SLOW-MO" : ""}`);
  }
  console.log(r.warnings.join("\n"));
})();
