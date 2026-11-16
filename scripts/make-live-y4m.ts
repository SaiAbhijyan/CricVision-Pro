/** Writes a Y4M camera feed of one synthetic 130 km/h delivery (with still frames either side) plus its true calibration, for
 *  scripts/e2e-live.cjs. Usage: npx tsx scripts/make-live-y4m.ts /tmp/live.y4m '{"dist":5,"height":2.2,"focal":0.73}' */
import { virtualCalibration } from "../lib/sim/virtual-camera";
import { buildCameraModel } from "../lib/physics/homography";
import { renderClip } from "./lib/synth-clip";
import { openSync, writeSync, closeSync, writeFileSync } from "fs";
(async () => {
  const W = 1280, H = 720, fps = 60;
  const out = process.argv[2] ?? "/tmp/live.y4m", rig = JSON.parse(process.argv[3] ?? '{"dist":5,"height":2.2,"focal":0.73}');
  const raw = virtualCalibration(W, H, "batter", rig);
  const clip = renderClip({ cam: buildCameraModel(raw)!, spec: { release: { x: -0.5, y: 1, z: 2.2 }, speedMs: 130 / 3.6, bounce: { x: 0.1, y: 14.5 }, backRpm: 0, turnRpm: 0, driftRpm: 0, swingAccel: 0, seamDir: 0, surface: "Green/Seam" }, fps, bg: 118, ball: 75, noise: 3, width: W } as any);
  const fd = openSync(out, "w");
  writeSync(fd, `YUV4MPEG2 W${W} H${H} F${fps}:1 Ip A1:1 C420jpeg\n`);
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const still = (await clip.src.frame(0, { pose: false })).gray;
  const put = (g: { w: number; h: number; data: Uint8ClampedArray }) => { let y = Buffer.from(g.data); if (g.w !== W) { const o = Buffer.alloc(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) o[r * W + c] = g.data[Math.floor(r * g.h / H) * g.w + Math.floor(c * g.w / W)]; y = o; } writeSync(fd, "FRAME\n"); writeSync(fd, y); writeSync(fd, uv); };
  for (let i = 0; i < 90; i++) put(still);                                  // 1.5 s quiet before
  for (let k = 0; k < clip.src.frameCount; k++) put((await clip.src.frame(k, { pose: false })).gray);
  for (let i = 0; i < 90; i++) put(still);
  closeSync(fd);
  const c = raw.corners, s = [...c].sort((a, b) => a.y - b.y), top = s.slice(0, 2).sort((a, b) => a.x - b.x), bot = s.slice(2).sort((a, b) => b.x - a.x);
  writeFileSync(out.replace(/\.y4m$/, "_cal.json"), JSON.stringify({ W, H, corners: [top[0], top[1], bot[0], bot[1]], stumpTop: raw.stumpTop, frames: clip.src.frameCount, truthKph: 130 }));
  console.log("frames", clip.src.frameCount + 180, "analysisWidth", clip.src.analysisWidth);
})();
