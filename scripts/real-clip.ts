/** Run the clip pipeline on a real video decoded with ffmpeg (Node): npx tsx scripts/real-clip.ts <file> <startS> <durS> <end> <w> <h> <tlx,tly,trx,try,brx,bry,blx,bly> <stumpx,stumpy> [mediaFps] [calT|-] [compensate]  (calT: clip seconds, from startS, of the frame the corners were read on) */
import { spawnSync } from "node:child_process";
import { analyseClip, type ClipSource } from "../lib/upload/analyse";
import { orientCalibration } from "../lib/upload/calibration";
import type { SessionConfig } from "../lib/types";

const [file, start, dur, end, W, H, cs, st, fpsArg, calTArg, motionArg] = process.argv.slice(2);
const w = +W, h = +H, AW = Math.min(960, w), AH = Math.round((h * AW) / w), fps = +(fpsArg ?? 30);
const c = cs.split(",").map(Number), s = st.split(",").map(Number);
const raw = spawnSync("ffmpeg", ["-v", "error", "-ss", start, "-t", dur, "-i", file, "-vf", `scale=${AW}:${AH},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 }).stdout;
const n = Math.floor(raw.length / (AW * AH));
const src: ClipSource = { width: w, height: h, analysisWidth: AW, fps, frameCount: n, frame: async (k) => ({ t: k / fps, gray: { w: AW, h: AH, data: new Uint8ClampedArray(raw.subarray(k * AW * AH, (k + 1) * AW * AH)) } }) };
const cfg: SessionConfig = { mode: "Bowling Focus", handedness: "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket", boundaryRadius: 65, outfield: "Medium", surface: "Green/Seam", format: "Net Free-Hit", batterWaist: 1, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0 };
(async () => {
  const cal = orientCalibration({ corners: [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }], stumpTop: { x: s[0], y: s[1] }, imageWidth: w, imageHeight: h }, end as "batter" | "bowler");
  console.log("frames", n);
  const t0 = Date.now();
  const r = await analyseClip(src, { cfg, cal, impacts: [], cameraMotion: motionArg === "compensate" ? "compensate" : "fixed", calT: calTArg && calTArg !== "-" ? +calTArg : 0 });
  console.log("seconds", ((Date.now() - t0) / 1000).toFixed(0));
  console.log("balls", r.balls.length, "diagnostics", JSON.stringify(r.diagnostics.map((d) => ({ pts: d.trackPoints, t: [+d.tStart.toFixed(2), +d.tEnd.toFixed(2)], reason: d.reason }))));
  for (const b of r.balls) console.log(`speed ${b.speedKph?.toFixed(1)} km/h  length ${b.length}  line ${b.line}  bounceY ${b.bounceYFromBatter?.toFixed(1)}  q=`, JSON.stringify(b.quality));
  console.log("warnings", r.warnings);
})();
