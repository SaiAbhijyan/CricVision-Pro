/**
 * The app's own pose model (MediaPipe Tasks PoseLandmarker, self-hosted .task, up to 4 people) on a folder of JPEG frames in
 * headless Chrome, so the app's exact pose input can be examined offline.
 * usage: node scripts/real-pose-tasks.cjs <framesDir> <first> <count> <out.json> [lite|full]
 */
const http = require("http"), fs = require("fs"), path = require("path");
const pp = require(process.env.PUPPETEER_PATH || "/tmp/e2e/node_modules/puppeteer-core");
const ROOT = path.join(__dirname, "..");
const [dir, first, count, out, model = "full"] = process.argv.slice(2);
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".jpg": "image/jpeg", ".task": "application/octet-stream" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/") { res.setHeader("content-type", "text/html"); return res.end("<canvas id=c></canvas>"); }
  const file = u.startsWith("/f/") ? path.join(dir, u.slice(3)) : u.startsWith("/tv/") ? path.join(ROOT, "node_modules/@mediapipe/tasks-vision", u.slice(4)) : path.join(ROOT, "public", u);
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); fs.createReadStream(file).pipe(res);
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await pp.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", protocolTimeout: 0, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage(); p.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 200)));
  p.on("console", (m) => { if (m.text().startsWith("PROG")) console.log(m.text()); });
  await p.goto(`http://localhost:${port}/`);
  const r = await p.evaluate(async (first, count, model) => {
    const { FilesetResolver, PoseLandmarker } = await import("/tv/vision_bundle.mjs");
    const fs = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const lm = await PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: `/models/pose_landmarker_${model}.task`, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 4, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    const c = document.getElementById("c"), g = c.getContext("2d"), frames = [], t0 = performance.now();
    for (let k = first; k < first + count; k++) {
      const im = await createImageBitmap(await (await fetch(`/f/${String(k).padStart(5, "0")}.jpg`)).blob());
      if (c.width !== im.width) { c.width = im.width; c.height = im.height; }
      g.drawImage(im, 0, 0); im.close();
      const res = lm.detectForVideo(c, Math.round((k * 1000) / 30));
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      frames.push({ k, people: res.landmarks.map((L, i) => ({ lm: L.map((q) => [r4(q.x), r4(q.y), r4(q.z), r4(q.visibility ?? 0)]), wl: res.worldLandmarks[i].map((q) => [r4(q.x), r4(q.y), r4(q.z)]) })) });
      if ((k - first) % 100 === 0) console.log(`PROG ${k - first}/${count} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
    }
    return { w: c.width, h: c.height, frames };
  }, +first, +count, model);
  fs.writeFileSync(out, JSON.stringify(r)); console.log("frames", r.frames.length, "with people", r.frames.filter((f) => f.people.length).length);
  await b.close(); srv.close();
});
