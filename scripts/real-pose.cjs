/**
 * Runs MediaPipe Pose (the legacy @mediapipe/pose solution, which ships its model inside the npm package, so it works offline)
 * on a real video in headless Chrome and writes every frame's 33 image and world landmarks to JSON.
 * usage: node scripts/real-pose.cjs <video> <startS> <durS> <stepFrames> <fps> <out.json> [poseDir]
 */
const http = require("http"), fs = require("fs"), path = require("path");
const pp = require(process.env.PUPPETEER_PATH || "/tmp/e2e/node_modules/puppeteer-core");
const [video, start, dur, step, fps, out, poseDir = "/tmp/mpn/node_modules/@mediapipe/pose"] = process.argv.slice(2);
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/") { res.setHeader("content-type", "text/html"); return res.end(`<video id=v muted playsinline preload=auto src="/video"></video><canvas id=c></canvas><script src="/p/pose.js"></script>`); }
  const file = u === "/video" ? video : path.join(poseDir, u.replace(/^\/p\//, ""));
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const size = fs.statSync(file).size, rg = req.headers.range;
  const type = file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  if (rg) { const [a, b] = rg.replace("bytes=", "").split("-"); const s = +a, e = b ? +b : size - 1; res.writeHead(206, { "content-range": `bytes ${s}-${e}/${size}`, "accept-ranges": "bytes", "content-length": e - s + 1, "content-type": type }); fs.createReadStream(file, { start: s, end: e }).pipe(res); }
  else { res.writeHead(200, { "content-length": size, "content-type": type, "accept-ranges": "bytes" }); fs.createReadStream(file).pipe(res); }
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await pp.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", protocolTimeout: 0, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage(); p.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 200)));
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => document.getElementById("v").readyState >= 2, { timeout: 60000 });
  const res = await p.evaluate(async (start, dur, step, fps) => {
    const v = document.getElementById("v"), c = document.getElementById("c"); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext("2d");
    const pose = new Pose({ locateFile: (f) => `/p/${f}` });
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: false, minDetectionConfidence: 0.4, minTrackingConfidence: 0.4, selfieMode: false });
    let last = null; pose.onResults((r) => { last = r; });
    await pose.initialize();
    const frames = [], n = Math.floor(dur * fps);
    for (let k = 0; k < n; k += step) {
      const t = start + (k + 0.5) / fps; v.currentTime = t; await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
      g.drawImage(v, 0, 0); last = null; await pose.send({ image: c });
      frames.push({ t: t - start, lm: last && last.poseLandmarks ? last.poseLandmarks.map((l) => [l.x, l.y, l.z, l.visibility]) : null, wl: last && last.poseWorldLandmarks ? last.poseWorldLandmarks.map((l) => [l.x, l.y, l.z, l.visibility]) : null });
    }
    return { w: v.videoWidth, h: v.videoHeight, frames };
  }, +start, +dur, +step, +fps);
  fs.writeFileSync(out, JSON.stringify(res)); console.log("frames", res.frames.length, "with pose", res.frames.filter((f) => f.lm).length);
  await b.close(); srv.close();
});
