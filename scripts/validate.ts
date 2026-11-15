/** Ground-truth validation of the clip pipeline on rendered footage. Prints error tables; exits 1 if tolerances are broken. */
import { virtualCalibration } from "../lib/sim/virtual-camera";
import { buildCameraModel } from "../lib/physics/homography";
import { analyseClip } from "../lib/upload/analyse";
import type { DeliverySpec } from "../lib/physics/ballistics";
import type { SessionConfig } from "../lib/types";
import { renderClip } from "./lib/synth-clip";
import { classifyLength, classifyLine } from "../lib/rules/umpire";
import { PITCH_LENGTH } from "../lib/physics/constants";
import { orientCalibration } from "../lib/upload/calibration";

const cfg: SessionConfig = { mode: "Bowling Focus", handedness: "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket", boundaryRadius: 65, outfield: "Medium", surface: "Green/Seam", format: "Net Free-Hit", batterWaist: 1, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0 };
const spec = (o: Partial<DeliverySpec> = {}): DeliverySpec => ({ release: { x: -0.5, y: 1, z: 2.2 }, speedMs: 36, bounce: { x: 0.1, y: 14.5 }, backRpm: 0, turnRpm: 0, driftRpm: 0, swingAccel: 0, seamDir: 0, surface: "Green/Seam", ...o });

interface Case { name: string; end: "batter" | "bowler"; fps: number; kph: number; bounceY: number; bounceX: number; swing: number; bg: number; ball: number; noise: number; distractor?: boolean; res?: [number, number] }
const cases: Case[] = [];
for (const end of ["batter", "bowler"] as const) for (const fps of [30, 60, 120, 240]) for (const kph of [95, 125, 145]) {
  cases.push({ name: `${end}-end ${fps}fps ${kph}kph red-on-pitch`, end, fps, kph, bounceY: 14.5, bounceX: 0.1, swing: 0, bg: 118, ball: 75, noise: 3 });
}
const fails: string[] = [];
const rows: string[] = []; let tot = 0, det = 0; const errs = { speed: [] as number[], bounceY: [] as number[], bounceX: [] as number[] };
async function main() {
  const only = process.argv[2];
  for (const c of cases) {
    if (only && !c.name.includes(only)) continue;
    const w = 1280, h = 720;
    const calRaw = virtualCalibration(w, h, c.end);
    // the user marks corners in on-screen order; reproduce that, then orient for the camera end
    const sorted = [...calRaw.corners].sort((a, b) => a.y - b.y); const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x), bot = sorted.slice(2).sort((a, b) => b.x - a.x);
    const screen = [top[0], top[1], bot[0], bot[1]] as typeof calRaw.corners;
    const cal = orientCalibration({ ...calRaw, corners: screen }, c.end);
    const cam = buildCameraModel(cal)!; const camTrue = buildCameraModel(calRaw)!;
    const rel = c.end === "batter" ? { x: -0.5, y: 1, z: 2.2 } : { x: -0.5, y: 1, z: 2.2 };
    const clip = renderClip({ cam: camTrue, spec: spec({ release: rel, speedMs: c.kph / 3.6, bounce: { x: c.bounceX, y: c.bounceY }, swingAccel: c.swing }), fps: c.fps, bg: c.bg, ball: c.ball, noise: c.noise, distractor: c.distractor, width: 960 });
    const t0 = Date.now();
    const res = await analyseClip(clip.src, { cfg, cal, impacts: [] });
    tot++;
    const b = res.balls[0];
    if (!b) { fails.push(`${c.name}: no delivery detected`); rows.push(`${c.name.padEnd(40)} NO DELIVERY  (${res.diagnostics.map((d) => `${d.trackPoints}pts ${d.reason ?? ""}`).join("; ") || "no track"})`); continue; }
    det++;
    const tb = clip.truth.bounce!;
    const eS = (b.speedKph ?? 0) - clip.truth.speedKph, eY = (PITCH_LENGTH - (b.bounceYFromBatter ?? 0)) - tb.y, eX = (b.bounceX ?? 0) - tb.x;
    // gates: accuracy where the ball is resolvable (>=60 fps), and honesty everywhere (a big error must not carry high confidence)
    const conf = b.quality?.confidence ?? 0;
    if (c.fps >= 60 && Math.abs(eS) > 6) fails.push(`${c.name}: speed error ${eS.toFixed(1)} km/h > 6`);
    if (c.fps >= 60 && Math.abs(eY) > 0.5) fails.push(`${c.name}: bounce length error ${eY.toFixed(2)} m > 0.5`);
    if (Math.abs(eX) > 0.2) fails.push(`${c.name}: bounce line error ${eX.toFixed(2)} m > 0.2`);
    if (Math.abs(eS) > 8 && conf > 0.7) fails.push(`${c.name}: ${eS.toFixed(1)} km/h wrong but confidence ${conf.toFixed(2)}`);
    errs.speed.push(eS); errs.bounceY.push(eY); errs.bounceX.push(eX);
    rows.push(`${c.name.padEnd(40)} pts=${String(b.quality?.trackPoints).padStart(3)} rms=${b.quality?.fitRmsPx} speed ${b.speedKph?.toFixed(1)} (truth ${clip.truth.speedKph.toFixed(1)}, ${eS >= 0 ? "+" : ""}${eS.toFixed(1)})  bounceY err ${eY.toFixed(2)} m  bounceX err ${eX.toFixed(2)} m  sig ±${b.quality?.speedSigmaKph} conf ${b.quality?.confidence.toFixed(2)}  ${Date.now() - t0} ms`);
  }
  console.log(rows.join("\n"));
  const stat = (a: number[]) => a.length ? `mean ${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2)}, mean|err| ${(a.reduce((s, x) => s + Math.abs(x), 0) / a.length).toFixed(2)}, max|err| ${Math.max(...a.map(Math.abs)).toFixed(2)}` : "n/a";
  console.log(`\ndetected ${det}/${tot}\nspeed km/h: ${stat(errs.speed)}\nbounce y m: ${stat(errs.bounceY)}\nbounce x m: ${stat(errs.bounceX)}`);
  if (fails.length) { console.log("\nFAILED:\n" + fails.join("\n")); process.exit(1); }
  console.log("\nall validation gates passed");
}
void classifyLength; void classifyLine;
main();
