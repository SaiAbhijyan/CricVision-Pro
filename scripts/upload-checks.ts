/** Assertion checks for clip upload: helpers, audio impacts, calibration orientation, fit robustness, segmentation, sanitising. Exit 1 on failure. */
import { virtualCalibration } from "../lib/sim/virtual-camera";
import { buildCameraModel, project } from "../lib/physics/homography";
import { fitFlightTo2D } from "../lib/physics/trackfit";
import { simulateDelivery } from "../lib/physics/ballistics";
import { orientCalibration } from "../lib/upload/calibration";
import { MAX_UPLOAD_BYTES, chooseAnalysisWidth, clipTime, effectiveFps, estimateFps, frameAtMediaTime, frameClipTime, frameSeekTime, rgbaToGray, validateUpload } from "../lib/upload/media";
import { detectImpacts, normaliseAudio } from "../lib/upload/audio";
import { analyseClip, flightConfidence, type ClipSource } from "../lib/upload/analyse";
import { mp4Fps } from "../lib/upload/mp4";
import { readFileSync, existsSync } from "fs";
import { generateBatter, defaultBatter } from "../lib/sim/synth-pose";
import { liftWeakPerspective } from "../lib/cv/skeleton";
import { detectSwings, finishedSwings } from "../lib/upload/swing";
import { sanitizeBall } from "../lib/security/sanitize";
import { renderClip, rng, gauss } from "./lib/synth-clip";
import type { SessionConfig, Pt } from "../lib/types";

let failed = 0, passed = 0;
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error("FAIL:", m); } };
const near = (a: number, b: number, tol: number, m: string) => ok(Math.abs(a - b) <= tol, `${m} (got ${a.toFixed(3)}, want ${b.toFixed(3)} ± ${tol})`);

const cfg: SessionConfig = { mode: "Bowling Focus", handedness: "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket", boundaryRadius: 65, outfield: "Medium", surface: "Green/Seam", format: "Net Free-Hit", batterWaist: 1, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0 };
const spec = (kph: number, bounceX = 0.1) => ({ release: { x: -0.5, y: 1, z: 2.2 }, speedMs: kph / 3.6, bounce: { x: bounceX, y: 14.5 }, backRpm: 0, turnRpm: 0, driftRpm: 0, swingAccel: 0, seamDir: 0, surface: "Green/Seam" as const });

/** corners in on-screen order, as the user marks them */
const screenOrder = (c: ReturnType<typeof virtualCalibration>) => {
  const s = [...c.corners].sort((a, b) => a.y - b.y), top = s.slice(0, 2).sort((a, b) => a.x - b.x), bot = s.slice(2).sort((a, b) => b.x - a.x);
  return { ...c, corners: [top[0], top[1], bot[0], bot[1]] as typeof c.corners };
};

/** a crack: a few ms of high-frequency noise with a fast decay */
function crack(n: number, sr: number, at: number, amp: number, r: () => number, ms = 3) {
  const out = new Float32Array(n), i0 = Math.round(at * sr), len = Math.round((ms / 1000) * sr * 4);
  for (let i = 0; i < len && i0 + i < n; i++) out[i0 + i] += amp * (r() * 2 - 1) * Math.exp(-i / ((ms / 1000) * sr));
  return out;
}
const mix = (...a: Float32Array[]) => { const o = new Float32Array(a[0].length); for (const x of a) for (let i = 0; i < o.length; i++) o[i] += x[i]; return o; };

/** two clips played one after the other (a second delivery in the same file) */
function concat(a: ClipSource, b: ClipSource, gapS: number): ClipSource {
  const offset = a.frameCount / a.fps + gapS;
  return { ...a, frameCount: a.frameCount + b.frameCount, frame: async (k, o) => (k < a.frameCount ? a.frame(k, o) : (async () => { const f = await b.frame(k - a.frameCount, o); return { ...f, t: f.t + offset }; })()) };
}

async function main() {
  /* ---- file validation ---- */
  ok(validateUpload({ name: "a.mp4", size: 1e6, type: "video/mp4" }) === null, "mp4 accepted");
  ok(validateUpload({ name: "IMG_1.MOV", size: 1e6, type: "video/quicktime" }) === null, "mov accepted");
  ok(validateUpload({ name: "IMG_1.MOV", size: 1e6, type: "" }) === null, "mov with no mime accepted by extension");
  ok(validateUpload({ name: "a.exe", size: 1e6, type: "application/x-msdownload" }) !== null, "exe rejected");
  ok(validateUpload({ name: "a.mp4.exe", size: 1e6, type: "" }) !== null, "double extension rejected");
  ok(validateUpload({ name: "a.mp4", size: 0, type: "video/mp4" }) !== null, "empty rejected");
  ok(validateUpload({ name: "a.mp4", size: MAX_UPLOAD_BYTES + 1, type: "video/mp4" }) !== null, "oversize rejected");
  ok(validateUpload({ name: "a.png", size: 5, type: "image/png" }) !== null, "image rejected");
  ok(validateUpload({ name: "a.svg", size: 5, type: "image/svg+xml" }) !== null, "svg rejected");
  ok(validateUpload({ name: "a.mp4", size: 5, type: "video/x-flv" }) === null, "an .mp4 with an unusual mime is left to the decoder, which reports real failures");
  ok(validateUpload({ name: "a.flv", size: 5, type: "video/x-flv" }) !== null, "a non-supported video type is rejected");
  ok(validateUpload(null as never) !== null && validateUpload({} as never) !== null, "garbage input rejected without throwing");

  /* ---- frame timing ---- */
  near(frameClipTime(240, 240, 1), 1, 1e-9, "240 frames at 240 fps is 1 s");
  near(frameClipTime(30, 30, 1 / 8), 1 / 8, 1e-9, "1 s of an 8x slow-motion clip is 0.125 real seconds");
  near(effectiveFps(30, 1 / 8), 240, 1e-9, "30 fps file at 8x is 240 fps real");
  near(effectiveFps(240, 1), 240, 1e-9, "240 fps file normal speed");
  near(clipTime(2, 0.25), 0.5, 1e-9, "media 2 s at 4x slow motion is 0.5 s");
  for (const fps of [24, 30, 60, 240]) for (const k of [0, 1, 17, 999]) ok(frameAtMediaTime(frameSeekTime(k, fps), fps) === k, `seek time of frame ${k} at ${fps} fps maps back to ${k}`);
  ok(frameAtMediaTime(-1, 30) === 0, "negative media time clamps to frame 0");

  /* ---- frame-rate estimation ---- */
  const ts = (fps: number, n: number, jit = 0, drop = 0) => { const r = rng(7); const o: number[] = []; for (let i = 0; i < n; i++) if (!(drop && i % drop === drop - 1)) o.push(i / fps + (r() - 0.5) * jit); return o; };
  ok(estimateFps(ts(30, 40)) === 30, "30 fps estimated exactly");
  ok(estimateFps(ts(240, 40)) === 240, "240 fps estimated");
  ok(estimateFps(ts(60, 40, 0.002)) === 60, "60 fps with timestamp jitter");
  ok(estimateFps(ts(30, 60, 0, 7)) === 30, "30 fps with dropped frames (median gap ignores them)");
  ok(estimateFps(ts(29.97, 40)) === 30, "29.97 snaps to 30");
  ok(estimateFps([0, 1]) === null && estimateFps([]) === null, "too few timestamps gives null");
  ok(estimateFps([NaN, 0, 0.1, 0.2, 0.3]) !== null, "NaN timestamps are ignored");
  ok(Math.abs((estimateFps(ts(37, 40)) ?? 0) - 37) < 0.5, "unusual rate is kept, not snapped");

  /* ---- pixels ---- */
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const g = rgbaToGray(px, 3, 1);
  ok(g[0] >= 254 && g[1] === 0 && g[2] > 50 && g[2] < 90, "luma of white, black and red");
  ok(chooseAnalysisWidth(1920) === 960 && chooseAnalysisWidth(640) === 640 && chooseAnalysisWidth(100) === 320, "analysis width clamps to 320..960 and never upscales above the video");

  /* ---- camera-end orientation ---- */
  for (const end of ["batter", "bowler"] as const) {
    const raw = virtualCalibration(1280, 720, end);
    const model = buildCameraModel(orientCalibration(screenOrder(raw), end))!, truth = buildCameraModel(raw)!;
    ok(!!model && model.reprojErrorPx < 1.5, `${end}-end orientation builds a clean camera (reproj ${model?.reprojErrorPx.toFixed(2)})`);
    let worst = 0;
    for (const p of [{ x: 0, y: 10, z: 0 }, { x: 1, y: 3, z: 1 }, { x: -1, y: 18, z: 2 }, { x: 0, y: 20.12, z: 0.7 }]) { const a = project(model, p)!, b = project(truth, p)!; worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y)); }
    ok(worst < 2, `${end}-end: oriented camera projects like the true camera (worst ${worst.toFixed(2)} px)`);
  }
  // a wrong orientation must NOT match (guards against a no-op orientCalibration)
  { const raw = virtualCalibration(1280, 720, "bowler"), wrong = buildCameraModel(screenOrder(raw)), truth = buildCameraModel(raw)!;
    let worst = 0; if (wrong) { const p = { x: 1, y: 3, z: 1 }, a = project(wrong, p), b = project(truth, p); if (a && b) worst = Math.hypot(a.x - b.x, a.y - b.y); } else worst = 1e9;
    ok(worst > 20, `treating a bowler-end clip as batter-end gives a visibly wrong camera (${worst.toFixed(0)} px)`); }

  /* ---- audio impacts ---- */
  const sr = 44100, N = sr * 6, R = rng(3);
  const bg = new Float32Array(N); for (let i = 0; i < N; i++) bg[i] = 0.01 * gauss(R);
  { const a = mix(bg, crack(N, sr, 2.0, 0.6, R)), ev = detectImpacts([a], sr);
    ok(ev.length === 1, `one crack gives one impact (got ${ev.length})`);
    if (ev[0]) near(ev[0].tPerf, 2.0, 0.004, "impact time within 4 ms"); }
  { const a = mix(bg, crack(N, sr, 2.0, 0.6, R)), ev = detectImpacts([a], sr, { timeScale: 1 / 8 });
    if (ev[0]) near(ev[0].tPerf, 2.0 / 8, 0.001, "slow-motion scaling of the impact time"); else ok(false, "timeScale case found no impact"); }
  { const a = mix(bg, crack(N, sr, 1.0, 0.5, R), crack(N, sr, 4.0, 0.5, R)); ok(detectImpacts([a], sr).length === 2, "two cracks give two impacts"); }
  { const a = mix(bg, crack(N, sr, 2.0, 0.02, R)); const ev = detectImpacts([a], sr); ok(ev.length <= 1, "very quiet tick does not produce several"); }
  { // commentary / crowd: loud low-frequency content must not read as an impact
    const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = 0.3 * Math.sin(2 * Math.PI * 180 * (i / sr)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * (i / sr))) + 0.02 * gauss(R);
    ok(detectImpacts([a], sr).length === 0, "steady low-frequency voice-like tone gives no impact"); }
  { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = 0.2 * gauss(R); ok(detectImpacts([a], sr).length <= 3, "loud steady noise (crowd) does not produce a burst of impacts"); }
  ok(detectImpacts([new Float32Array(0)], sr).length === 0, "empty audio gives no impacts");
  ok(detectImpacts([new Float32Array(N)], sr).length === 0, "silent audio gives no impacts");
  { const a = mix(bg, crack(N, sr, 2.0, 0.6, R)), l = a, r2 = new Float32Array(N); ok(detectImpacts([l, r2], sr).length === 1, "stereo with one silent channel still finds the impact"); }
  { const q = mix(bg, crack(N, sr, 2.0, 0.6, R)).map((x) => x * 0.01), loud = q.map((x) => x * 80); ok(detectImpacts([q], sr).length === detectImpacts([loud], sr).length, "loudness normalisation: same result at 100x the volume"); }
  ok(normaliseAudio([new Float32Array(10)]).length === 10, "normalise handles silence");

  /* ---- confidence ---- */
  { const good = flightConfidence(60, 0.8, 120, { speedKph: 130, releaseY: 1, coverage: 0.9, speedSigmaKph: 1 });
    ok(good.confidence > 0.95 && good.warnings.length === 0, "a clean flight keeps full confidence");
    const absurd = flightConfidence(60, 0.8, 120, { speedKph: 260, releaseY: 1, coverage: 0.9, speedSigmaKph: 1 });
    ok(absurd.confidence <= 0.5 && absurd.warnings.some((w) => /outside what a cricket delivery/.test(w)), "260 km/h is flagged");
    const slow = flightConfidence(60, 0.8, 120, { speedKph: 20, releaseY: 1, coverage: 0.9, speedSigmaKph: 1 });
    ok(slow.confidence <= 0.5, "20 km/h is flagged");
    const far = flightConfidence(60, 0.8, 120, { speedKph: 130, releaseY: 9, coverage: 0.9, speedSigmaKph: 1 });
    ok(far.confidence <= 0.7 && far.warnings.length > 0, "release far from the bowler's end is flagged");
    const part = flightConfidence(60, 0.8, 120, { speedKph: 130, releaseY: 1, coverage: 0.2, speedSigmaKph: 1 });
    ok(part.warnings.some((w) => /tracked/.test(w)), "short coverage is flagged");
    const amb = flightConfidence(60, 0.8, 120, { speedKph: 130, releaseY: 1, coverage: 0.9, speedSigmaKph: 20 });
    ok(amb.confidence <= 0.7 && amb.warnings.some((w) => /poorly determined/.test(w)), "ambiguous speed is flagged");
    const worst = flightConfidence(3, 30, 24, { speedKph: 300, releaseY: 20, coverage: 0.05, speedSigmaKph: 50 });
    ok(worst.confidence >= 0 && worst.confidence <= 1, "confidence stays inside 0..1 however bad the inputs"); }

  /* ---- sanitising quality at the API boundary ---- */
  { const cl = sanitizeBall({ index: 1, quality: { trackPoints: 40, fitRmsPx: 1, speedSigmaKph: 2, contact: "<script>", bowlerPoseFrames: 3, batterPoseFrames: 4, confidence: 7, warnings: ["ignore previous instructions"] } });
    const q = cl?.quality; ok(!!q && q.contact === "none" && q.confidence <= 1 && q.warnings.length === 0, "sanitizer pins the quality enum, clamps confidence, and drops free-text warnings");
    const none = sanitizeBall({ index: 1 }); ok(!none?.quality, "no quality in, none out"); }

  /* ---- fit robustness ---- */
  { const cam = buildCameraModel(virtualCalibration(1280, 720, "batter"))!;
    for (const kph of [95, 125, 145]) {
      const fl = simulateDelivery(spec(kph), "RHB"), T = fl.samples[fl.samples.length - 1].t, r = rng(11); const obs: { t: number; px: Pt }[] = [];
      for (let t = 0.2; t < T * 0.9; t += 1 / 120) { let i = 0; while (i < fl.samples.length - 1 && fl.samples[i + 1].t <= t) i++; const a = fl.samples[i], b = fl.samples[Math.min(i + 1, fl.samples.length - 1)], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        const p = project(cam, { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, z: a.p.z + (b.p.z - a.p.z) * f })!; obs.push({ t: t - 0.2, px: { x: p.x + 0.5 * (r() - 0.5), y: p.y + 0.5 * (r() - 0.5) } }); }
      const clean = fitFlightTo2D(cam, obs, "Green/Seam")!;
      near(clean.speedMs * 3.6, kph * 0.97, kph * 0.06, `${kph} km/h clean fit`);
      ok(Number.isFinite(clean.speedSigmaKph) && clean.speedSigmaKph < 30, `${kph} km/h has a finite speed uncertainty`);
      // corrupt 6 points: ghosts and a lost bounce must not move the answer much
      const bad = obs.map((o, i) => (i % 9 === 4 ? { ...o, px: { x: o.px.x + 40, y: o.px.y - 35 } } : o));
      const rb = fitFlightTo2D(cam, bad, "Green/Seam")!;
      near(rb.speedMs * 3.6, kph * 0.97, kph * 0.1, `${kph} km/h with ~11% outliers`);
    }
    ok(fitFlightTo2D(cam, [{ t: 0, px: { x: 1, y: 1 } }], "Green/Seam") === null, "one observation gives no fit"); }

  /* ---- pipeline on rendered footage ---- */
  const w = 1280, h = 720;
  const mkCal = (end: "batter" | "bowler") => orientCalibration(screenOrder(virtualCalibration(w, h, end)), end);
  const rc = (o: Partial<Parameters<typeof renderClip>[0]> & { kph?: number; end?: "batter" | "bowler" } = {}) => renderClip({ cam: buildCameraModel(virtualCalibration(w, h, o.end ?? "batter"))!, spec: spec(o.kph ?? 125), fps: 60, bg: 118, ball: 75, noise: 3, width: 960, ...o } as never);

  { const clip = rc();
    const r = await analyseClip(clip.src, { cfg, cal: mkCal("batter"), impacts: [] });
    ok(r.balls.length === 1, "one delivery found in a one-delivery clip");
    const b = r.balls[0]; if (b) { near(b.speedKph ?? 0, 125, 6, "speed"); ok(b.quality?.contact === "none" && (b.quality?.warnings.some((x) => /No bat or pad contact/.test(x)) ?? false), "no contact is stated, not invented"); ok(b.synthetic === false, "uploaded balls are not marked synthetic"); } }

  { // manual contact at the stumps: marked as manual, batting analysis attempted
    const clip = rc();
    const r = await analyseClip(clip.src, { cfg: { ...cfg, mode: "Full Match Duel (1v1)" }, cal: mkCal("batter"), impacts: [], manualContact: { t: clip.truth.tStumps - 0.02, kind: "bat-sweet" } });
    ok(r.balls.length === 1 && r.balls[0].quality?.contact === "manual", "manual contact is recorded as manual"); }

  { // a contact the audio found long before the ball: ignored
    const clip = rc();
    const r = await analyseClip(clip.src, { cfg, cal: mkCal("batter"), impacts: [{ tPerf: 0.01, peak: 0.5, ratio: 20, decayMs: 3, kind: "bat-sweet", precisionMs: 1 }] });
    ok(r.balls.length === 1 && r.balls[0].quality?.contact === "none", "a thump before the ball arrives is not taken as contact"); }

  { // two deliveries in one file
    const a = rc({ kph: 110 }), b = rc({ kph: 140 });
    const r = await analyseClip(concat(a.src, b.src, 1.0), { cfg, cal: mkCal("batter"), impacts: [] });
    ok(r.balls.length === 2, `two deliveries are found separately (got ${r.balls.length})`);
    if (r.balls.length === 2) { near(r.balls[0].speedKph ?? 0, 110, 7, "first delivery speed"); near(r.balls[1].speedKph ?? 0, 140, 8, "second delivery speed"); ok(r.balls[0].index !== r.balls[1].index, "deliveries are numbered separately"); } }

  { // no delivery at all: a static scene with sensor noise
    const clip = rc({ kph: 125 }); const r2 = rng(5);
    const empty: ClipSource = { ...clip.src, frame: async (k) => { const f = await clip.src.frame(0, { pose: false }); const d = new Uint8ClampedArray(f.gray.data); for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(255, d[i] + 3 * gauss(r2))); return { t: k / clip.src.fps, gray: { ...f.gray, data: d } }; } };
    const r = await analyseClip(empty, { cfg, cal: mkCal("batter"), impacts: [] });
    ok(r.balls.length === 0, `no delivery in an empty scene (got ${r.balls.length})`);
    ok(r.warnings.some((x) => /No delivery was found/.test(x)), "the empty result says what to check"); }

  { // distractor: a runner crossing the pitch must not become the ball
    const clip = rc({ distractor: true } as never);
    const r = await analyseClip(clip.src, { cfg, cal: mkCal("batter"), impacts: [] });
    ok(r.balls.length >= 1 && Math.abs((r.balls[0]?.speedKph ?? 0) - 125) < 10, `a moving bowler-sized distractor does not break the track (got ${r.balls[0]?.speedKph?.toFixed(0)})`); }

  { // abort stops promptly and does not throw
    const clip = rc(); const sig = { aborted: false }; let n = 0;
    const r = await analyseClip(clip.src, { cfg, cal: mkCal("batter"), impacts: [], signal: sig, onProgress: () => { if (++n === 2) sig.aborted = true; } });
    ok(r.balls.length === 0 && n < 20, "abort returns early with nothing analysed"); }

  { // a bad calibration is rejected with a readable message
    const bad = { ...mkCal("batter"), corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }] as never };
    let msg = ""; try { await analyseClip(rc().src, { cfg, cal: bad, impacts: [] }); } catch (e) { msg = (e as Error).message; }
    ok(/Calibration failed/.test(msg), "a degenerate calibration throws a readable error"); }

  { // wrong slow-motion factor must change speed visibly (so the UI warning is justified)
    const clip = rc({ kph: 125 }); const slowed: ClipSource = { ...clip.src, fps: clip.src.fps * 4, frame: async (k, o) => { const f = await clip.src.frame(k, o); return { ...f, t: f.t / 4 }; } };
    const r = await analyseClip(slowed, { cfg, cal: mkCal("batter"), impacts: [] });
    if (r.balls[0]) ok(Math.abs((r.balls[0].speedKph ?? 0) - 125) > 40, "a wrong time scale is not silently absorbed"); }

  { // frame-rate conversion duplicates frames: the result must match the clean clip
    const clip = rc({ kph: 125, fps: 60 });
    let last: Awaited<ReturnType<ClipSource["frame"]>> | null = null;
    const dup: ClipSource = { ...clip.src, frame: async (k, o) => { const f = await clip.src.frame(k, o); if (k % 3 === 2 && last) return { ...f, gray: last.gray }; last = f; return f; } };
    const r = await analyseClip(dup, { cfg, cal: mkCal("batter"), impacts: [] });
    const b0 = r.balls[0]; ok(!!b0 && (Math.abs((b0.speedKph ?? 0) - 125) < 10 || ((b0.quality?.confidence ?? 1) <= 0.6 && (b0.quality?.speedSigmaKph ?? 0) >= 15)), `duplicate frames: accurate or honestly flagged (got ${b0?.speedKph}, conf ${b0?.quality?.confidence})`); ok(r.warnings.some((x) => /exact repeats/.test(x)), "duplicate frames are reported to the user"); }

  { // a clip whose picture shifts every frame (panning/zooming camera) must be flagged, never reported as confident
    const clip = rc({ kph: 125, fps: 60 }); const rnd = rng(7);
    const shaky: ClipSource = { ...clip.src, frame: async (k, o) => { const f = await clip.src.frame(k, o); const g = f.gray; const d = g.data.slice(); for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(255, d[i] + (rnd() - 0.5) * 140)); return { ...f, gray: { ...g, data: d } }; } };
    const r = await analyseClip(shaky, { cfg, cal: mkCal("batter"), impacts: [] });
    ok(r.balls.every((b) => (b.quality?.confidence ?? 0) <= 0.35) && r.warnings.length > 0, "a noisy/moving-camera clip is flagged and low-confidence"); }

  { // exact frame rate from the container (real ffmpeg-made files, when present)
    for (const [f, fps] of [["/tmp/e2e/ball.mp4", 120], ["/tmp/e2e/test.mp4", 60]] as const) {
      if (!existsSync(f)) continue; const buf = readFileSync(f);
      const got = await mp4Fps(buf.length, async (a, b) => new Uint8Array(buf.subarray(a, b)));
      ok(got !== null && Math.abs(got - fps) < 0.5, `mp4Fps ${f} = ${got}`); }
    ok((await mp4Fps(100, async () => new Uint8Array(100))) === null, "mp4Fps: garbage gives null");
    ok((await mp4Fps(0, async () => new Uint8Array(0))) === null, "mp4Fps: empty gives null");
    const trunc = readFileSync("/tmp/e2e/ball.mp4").subarray(0, 5000); ok((await mp4Fps(trunc.length, async (a, b) => new Uint8Array(trunc.subarray(a, b)))) === null || true, "mp4Fps: truncated file does not throw"); }

  { // swing-only analysis: batters with no ball in the footage
    const batCfg: SessionConfig = { ...cfg, mode: "Full Match Duel (1v1)" as never };
    const mk = (sk: ReturnType<typeof generateBatter>, shift = 0): ClipSource => {
      const blank = { w: 64, h: 36, data: new Uint8ClampedArray(64 * 36).fill(100) };
      return { analysisWidth: 64, width: 1280, height: 720, fps: 30, frameCount: sk.length, frame: async (k) => ({ t: sk[k].t + shift, gray: blank, pose: { bowler: null, batter: { ...sk[k], t: sk[k].t + shift }, people: 1 } }) };
    };
    const one = generateBatter(defaultBatter({ fps: 30, impactT: 0.55, frontFootPct: 80 }));
    const sw = detectSwings(one);
    ok(sw.length === 1 && Math.abs(sw[0] - 0.55) < 0.25, `one swing found near contact (${sw.map((x) => x.toFixed(2))})`);
    const r = await analyseClip(mk(one), { cfg: batCfg, cal: mkCal("batter"), impacts: [] });
    ok(r.balls.length === 1 && !!r.balls[0].batting && r.balls[0].speedKph === null, "swing-only record has batting numbers and no ball");
    ok((r.balls[0]?.batting?.batSpeedKph ?? 0) > 20 && (r.balls[0]?.batting?.frontFootPct ?? 0) > 55, `swing numbers are sensible (bat ${r.balls[0]?.batting?.batSpeedKph}, front ${r.balls[0]?.batting?.frontFootPct})`);
    ok(r.balls[0]?.quality?.confidence !== undefined && r.balls[0].quality!.confidence <= 0.6, "swing-only confidence is capped");
    ok(r.warnings.some((x) => /no ball tracked/.test(x)), "user is told the swing was analysed without a ball");
    const two = [...one, ...generateBatter(defaultBatter({ fps: 30, impactT: 0.55, frontFootPct: 30 })).map((f) => ({ ...f, t: f.t + 6 }))];
    { const fin = finishedSwings(one, "RHB", batCfg, -Infinity, one[one.length - 1].t, 0, 0); ok(fin.length === 1, "live helper emits a finished swing once");
      ok(finishedSwings(one, "RHB", batCfg, fin[0].impactT, one[one.length - 1].t, 1, 0).length === 0, "live helper does not repeat a swing already recorded");
      ok(finishedSwings(one, "RHB", batCfg, -Infinity, fin[0].impactT + 0.1, 0, 0).length === 0, "live helper waits for the follow-through"); }
    ok(detectSwings(two).length === 2, "two swings in one clip are both found");
    const leave = generateBatter(defaultBatter({ fps: 30, impactT: 0.55, swing: false }));
    ok(detectSwings(leave).length === 0, "a leave (no stroke) is not a swing");
    const { offlineReport } = await import("../lib/coach/offline");
    const rep = offlineReport({ id: "x", startedAt: 0, endedAt: 0, config: batCfg, balls: r.balls, runs: 0, wickets: 0, legalBalls: 0 } as never);
    ok(/1 swing analysed/.test(rep.headline) && rep.whatWentRight.some((x) => /swing.*measured/.test(x)), "coach report describes swing-only sessions: " + rep.headline);
    ok(sanitizeBall(r.balls[0])?.flags.includes("Swing only (no ball tracked)") === true, "server sanitizer keeps the swing-only flag");
    const rb = await analyseClip(mk(one), { cfg: { ...batCfg, mode: "Bowling Focus" }, cal: mkCal("batter"), impacts: [] });
    ok(rb.balls.length === 0, "bowling-focus sessions do not produce swing records");
    ok(detectSwings(one.slice(0, 5)).length === 0, "too few pose frames give no swings"); }

  { // long-lens lift: an upright figure stays upright, scale and position follow the pixels
    const img = Array.from({ length: 33 }, (_, i) => ({ x: 0.5 + (i === 23 || i === 24 ? 0.05 * (i === 23 ? -1 : 1) : 0), y: 0.5 + i * 0.01 }));
    const wld = Array.from({ length: 33 }, (_, i) => ({ x: i === 23 ? -0.1 : i === 24 ? 0.1 : 0, y: i === 27 || i === 28 ? 0.9 : i === 23 || i === 24 ? 0 : -0.3, z: 0 }));
    const a = liftWeakPerspective(img, wld, 0, { metresPerPx: 0.004, refPx: 960, imageWidth: 1920, pitchDeg: 15, hipY: 19 });
    const b = liftWeakPerspective(img.map((p) => ({ ...p, x: p.x + 0.1 })), wld, 0, { metresPerPx: 0.004, refPx: 960, imageWidth: 1920, pitchDeg: 15, hipY: 19 });
    ok(!!a && !!b && a.j.nose.z > a.j.lAnk.z + 1.0, "long-lens lift: head above feet");
    ok(!!a && !!b && Math.abs((b.j.lHip.x - a.j.lHip.x) - 0.1 * 1920 * 0.004) < 1e-6, "long-lens lift: moving 10% of the frame moves the body by pixels x scale");
    ok(liftWeakPerspective([], [], 0, { metresPerPx: 0.004, refPx: 0, imageWidth: 1, pitchDeg: 0, hipY: 0 }) === null, "long-lens lift: bad input gives null"); }

  { // unreliable swing numbers are marked, not shown as fact
    const { extractBatting } = await import("../lib/cv/biomech");
    const clean = generateBatter(defaultBatter({ fps: 30, impactT: 0.55, frontFootPct: 80 }));
    const c = extractBatting(clean, { hand: "RHB", impactT: 0.55 })!;
    ok(!c.biomech.unmeasured, "a clean synthetic swing is fully measured");
    const r = rng(11);
    const noisy = clean.map((f) => { const j = { ...f.j } as typeof f.j; for (const k of Object.keys(j) as (keyof typeof j)[]) j[k] = { ...j[k], y: j[k].y + (r() - 0.5) * 0.9 }; return { t: f.t, j }; });
    const nb = extractBatting(noisy, { hand: "RHB", impactT: 0.55 })!;
    ok(nb.biomech.unmeasured?.includes("weight") === true, "depth noise along the stride marks weight as unmeasured");
    const fast = clean.map((f) => ({ ...f, t: f.t / 6 }));   // wrong slow-motion factor
    const fb = extractBatting(fast, { hand: "RHB", impactT: 0.55 / 6 })!;
    ok(fb.biomech.unmeasured?.includes("batSpeed") === true, `an impossible bat speed is marked unmeasured (raw ${fb.biomech.batSpeedKph})`);
    const sb = sanitizeBall({ ...(await analyseClip(rc().src, { cfg, cal: mkCal("batter"), impacts: [] })).balls[0], batting: { ...nb.biomech, unmeasured: ["weight", "evil"] } });
    ok(JSON.stringify(sb?.batting?.unmeasured) === '["weight"]', "sanitizer keeps only known unmeasured tags"); }

  console.log(`upload checks: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
