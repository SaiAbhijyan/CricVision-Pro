/** Live camera end to end: Chrome with a fake camera playing a Y4M (scripts/make-live-y4m.ts), calibrate by dragging the real
 *  handles, collect deliveries for 30 s, finish, read the report and IndexedDB. Needs `npm i puppeteer-core`, Chrome, and
 *  `next start -p 3111`. Usage: node scripts/e2e-live.cjs /tmp/live.y4m /tmp/live_cal.json */
const pp = require("puppeteer-core"); const fs = require("fs");
const Y4M = process.argv[2] ?? "/tmp/live.y4m", cal = JSON.parse(fs.readFileSync(process.argv[3] ?? "/tmp/live_cal.json", "utf8"));
(async () => {
  const b = await pp.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", protocolTimeout: 0, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + Y4M, "--autoplay-policy=no-user-gesture-required"] });
  const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1100 }); const bad = [], net = [];
  p.on("console", (m) => { if (m.type() === "error" || /Content Security|Refused/i.test(m.text())) bad.push(m.text().slice(0, 220)); });
  p.on("pageerror", (e) => { bad.push("PAGEERR " + String(e).slice(0, 300)); console.log("PAGEERR", (e.stack||String(e)).slice(0, 1200)); });
  p.on("request", (r) => { const u = r.url(); if (!/^(http:\/\/localhost|data:|blob:)/.test(u)) net.push(u.slice(0, 90)); });
  await p.goto("http://localhost:3111/", { waitUntil: "networkidle0" });
  await p.evaluate(() => { localStorage.setItem("cvp-config", JSON.stringify({ mode: "Full Match Duel (1v1)", format: "Net Free-Hit" })); });
  await p.goto("http://localhost:3111/session?mode=live", { waitUntil: "networkidle0" });
  const click = async (txt) => { const h = await p.evaluateHandle((t) => [...document.querySelectorAll("button")].find((x) => x.innerText.trim().startsWith(t)), txt); const e = h.asElement(); if (!e) throw new Error("no button " + txt); await e.click(); };
  await click("Start camera");
  await p.waitForSelector("svg[viewBox='0 0 1280 720'] g circle", { timeout: 60000 });
  const svg = await p.$("svg[viewBox='0 0 1280 720']"); const bb = await svg.boundingBox();
  const vb = "0 0 1280 720";
  const [, , vw, vh] = vb.split(" ").map(Number);
  const targets = [...cal.corners, cal.stumpTop];
  for (let i = 0; i < 5; i++) {
    const c = (await svg.$(`g[data-handle="${i}"] circle`)); const cb = await c.boundingBox();
    await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.mouse.down();
    await p.mouse.move(bb.x + (targets[i].x / vw) * bb.width, bb.y + (targets[i].y / vh) * bb.height, { steps: 8 }); await p.mouse.up();
  }
  console.log("handles", await svg.$$eval("g[data-handle] circle:last-child", (cs) => cs.slice(0,5).map((c) => Math.round(c.getAttribute("cx")) + "," + Math.round(c.getAttribute("cy"))).join(" ")), "target", JSON.stringify([...cal.corners, cal.stumpTop].map((q) => Math.round(q.x) + "," + Math.round(q.y))), "viewBox", vb, "video", await p.evaluate(() => { const v = document.querySelector("video"); return `${v.videoWidth}x${v.videoHeight}`; }));
  await click("Lock now"); for (let i=0;i<4;i++){ await new Promise(r=>setTimeout(r,4000)); console.log("after lock", await p.evaluate(() => [...document.querySelectorAll("p")].map(x=>x.innerText).filter(t=>/Live|Loading|Could not|Calib|Reproj/.test(t)).join(" || ")), "|", await p.evaluate(() => document.querySelector("[data-testid=track-rate]")?.innerText)); }
  const t0 = Date.now();
  await p.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.startsWith("Finish")); return b && !b.disabled; }, { timeout: 60000, polling: 1000 }).catch(() => console.log("no delivery within 240 s"));
  console.log("first delivery after", ((Date.now() - t0) / 1000).toFixed(0), "s; status:", await p.evaluate(() => document.body.innerText.match(/(Live\.[^\n]*|Loading[^\n]*|Delivery[^\n]*)/)?.[0]), "| pose:", await p.evaluate(() => document.querySelector("[data-testid=pose-note]")?.innerText));
  for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 5000)); console.log("t+", (i + 1) * 5, await p.evaluate(() => document.querySelector("[data-testid=track-rate]")?.innerText), "|", await p.evaluate(() => [...document.querySelectorAll("p")].map((x) => x.innerText).find((t) => /Delivery|Live\.|Could not/.test(t)))); }
  await click("Finish");
  await p.waitForFunction(() => /\/report\//.test(location.pathname), { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const txt = await p.evaluate(() => document.body.innerText);
  console.log("REPORT:", txt.slice(0, 900).replace(/\n+/g, " | "));
  const balls = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("cricvision-pro"); r.onsuccess = () => { const tx = r.result.transaction("sessions"); const g = tx.objectStore("sessions").getAll(); g.onsuccess = () => { const s = g.result.sort((a, b) => b.startedAt - a.startedAt)[0]; res((s?.balls ?? []).map((b) => [b.speedKph?.toFixed?.(1) ?? b.speed, b.quality?.confidence?.toFixed?.(2), b.quality?.speedSigmaKph?.toFixed?.(1), b.quality?.trackPoints, (b.quality?.warnings ?? []).map((w) => w.slice(0, 40)).join(" / ")])); }; }; }));
  console.log("BALLS", JSON.stringify(balls));
  console.log("speed mentions:", (txt.match(/\d+(\.\d)? ?km\/h/g) ?? []).slice(0, 6), "truth", cal.truthKph);
  console.log("THIRD-PARTY:", net.length, "BAD:", bad.length, JSON.stringify(bad.slice(0, 4)));
  await b.close();
})().catch((e) => { console.error("E2E FAIL", e); process.exit(1); });
