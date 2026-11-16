/**
 * MediaPipe Pose (legacy npm solution, model bundled: runs offline) on a folder of JPEG frames, in headless Chrome.
 * Faster than seeking a <video>: frames are decoded once by ffmpeg.
 * usage: node scripts/real-pose-frames.cjs <framesDir> <first> <count> <out.json> [poseDir]
 */
const http = require("http"), fs = require("fs"), path = require("path");
const pp = require(process.env.PUPPETEER_PATH || "/tmp/e2e/node_modules/puppeteer-core");
const [dir, first, count, out, poseDir = "/tmp/mpn/node_modules/@mediapipe/pose"] = process.argv.slice(2);
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/") { res.setHeader("content-type", "text/html"); return res.end(`<canvas id=c></canvas><script src="/p/pose.js"></script>`); }
  const file = u.startsWith("/f/") ? path.join(dir, u.slice(3)) : path.join(poseDir, u.replace(/^\/p\//, ""));
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
  res.writeHead(200, { "content-type": type }); fs.createReadStream(file).pipe(res);
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await pp.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", protocolTimeout: 0, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage(); p.on("pageerror", (e) => console.error("PAGEERR", String(e).slice(0, 200)));
  p.on("console", (m) => { if (m.text().startsWith("PROG")) process.stdout.write(m.text() + "\n"); });
  await p.goto(`http://localhost:${port}/`);
  const res = await p.evaluate(async (first, count) => {
    const c = document.getElementById("c"); const g = c.getContext("2d");
    const pose = new Pose({ locateFile: (f) => `/p/${f}` });
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    let last = null; pose.onResults((r) => { last = r; }); await pose.initialize();
    const frames = []; const t0 = performance.now();
    for (let k = first; k < first + count; k++) {
      const im = await createImageBitmap(await (await fetch(`/f/${String(k).padStart(5, "0")}.jpg`)).blob());
      if (c.width !== im.width) { c.width = im.width; c.height = im.height; }
      g.drawImage(im, 0, 0); im.close(); last = null; await pose.send({ image: c });
      const L = last && last.poseLandmarks, Wl = last && last.poseWorldLandmarks;
      frames.push({ k, lm: L ? L.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +l.z.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) : null, wl: Wl ? Wl.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +l.z.toFixed(4)]) : null });
      if ((k - first) % 200 === 0) console.log(`PROG ${k - first}/${count} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
    }
    return { w: c.width, h: c.height, frames };
  }, +first, +count);
  fs.writeFileSync(out, JSON.stringify(res)); console.log("frames", res.frames.length, "with pose", res.frames.filter((f) => f.lm).length);
  await b.close(); srv.close();
});
