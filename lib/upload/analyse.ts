/**
 * Offline clip analysis: the same ball tracking, pose, audio-impact and physics pipeline as the live camera, driven by a
 * `ClipSource` (an uploaded video in the browser, rendered frames in tests). It returns the same BallRecords, so the
 * scoreboard, report and replay screens treat an uploaded clip exactly like a live session.
 */
import type { AnalysisQuality, BallRecord, Calibration, CameraModel, ClipMeta, FieldPlayer, SessionConfig } from "@/lib/types";
import { buildCameraModel, cameraCentre } from "@/lib/physics/homography";
import { fitFlightTo2D, type FitResult, type TrackObs } from "@/lib/physics/trackfit";
import { toGray, type Gray } from "@/lib/cv/ball-detector";
import type { Skeleton } from "@/lib/cv/skeleton";
import type { PosePair } from "@/lib/cv/pose";
import { alignToStance, detectSwings, fixLeftRight, stanceAxisToCameraDeg, swingRecords } from "@/lib/upload/swing";
import { BATTER_CREASE_Y } from "@/lib/physics/constants";
import { CutDetector, shotsFromCuts, type Shot } from "@/lib/upload/shots";
import { DeliveryTracker } from "@/lib/live/delivery-tracker";
import { IDENTITY, composeZP, estimateZoomPan, invertZP, type ZoomPan } from "@/lib/cv/stabilise";
import { buildLiveBall, fitObs, type TrackPt } from "@/lib/live/pipeline";
import { applyOutcome, newScore, type ScoreState, type WagonPoint } from "@/lib/rules/scoreboard";
import { applyDisguiseScores, buildField, defaultFieldPreset } from "@/lib/sim/match-sim";
import type { ImpactEvent } from "@/lib/audio/transient";
import type { ImpactKind } from "@/lib/audio/onset-core";

export const SMALL_W = 480;

export interface ClipFrame { t: number; gray: Gray; pose?: PosePair }
export interface ClipSource {
  /** full-resolution size the calibration refers to */
  width: number; height: number;
  /** width of the frames returned by frame(): the ball is small, so uploads analyse at higher resolution than the live path */
  analysisWidth: number;
  /** real-time frames per second (after any slow-motion factor) */
  fps: number;
  frameCount: number;
  /** Frame k at the downscaled analysis size. `t` is clip time in real seconds. */
  frame(k: number, o: { pose: boolean; poseCam?: CameraModel }): Promise<ClipFrame>;
  /** called at a camera cut, so person-following restarts in the new shot */
  newShot?(): void;
}

export interface ManualContact { t: number; kind: ImpactKind }

export interface AnalyseOptions {
  /** analyse only this part of the clip, in clip seconds (e.g. one camera shot of a highlights reel) */
  range?: { start: number; end: number };
  cfg: SessionConfig;
  /** "compensate": the camera zooms or pans (TV footage). Each frame's motion is measured and undone, inside the camera shot
   *  that contains the calibration frame `calT` (clip seconds). */
  cameraMotion?: "fixed" | "compensate";
  calT?: number;
  /** null = batting-only footage: no pitch calibration, no ball tracking, swings measured from the body alone */
  cal: Calibration | null;
  impacts: ImpactEvent[];
  /** user-marked contact; overrides audio */
  manualContact?: ManualContact | null;
  poseStride?: number;
  /** run the 3-D fit elsewhere (a Worker); defaults to inline */
  fit?: (cam: CameraModel, obs: TrackObs[], surface: SessionConfig["surface"]) => Promise<FitResult | null>;
  /** called for every flagged ball so the caller can build a highlight clip from its own frame buffer */
  onDelivery?: (d: DeliveryInfo) => Promise<void> | void;
  signal?: { aborted: boolean };
  onProgress?: (k: number, n: number, note: string) => void;
}

export interface DeliveryInfo {
  index: number; tStart: number; tEnd: number; track: TrackPt[]; record: BallRecord;
  bowler: Skeleton[]; batter: Skeleton[];
  /** zooming camera only: maps calibration-frame pixels (full resolution) into the frame at clip time t */
  refToFrame?: (t: number) => ZoomPan;
}

export interface DeliveryDiag {
  index: number; tStart: number; tEnd: number; trackPoints: number; analysed: boolean; reason?: string;
  contact: AnalysisQuality["contact"]; contactT: number | null; quality?: AnalysisQuality;
}

export interface AnalyseResult {
  balls: BallRecord[]; wagons: (WagonPoint | undefined)[]; score: ScoreState; field: FieldPlayer[]; diagnostics: DeliveryDiag[]; warnings: string[]; model: CameraModel | null;
  /** camera shots found in the analysed range */
  shots: Shot[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Trust in the flight numbers from how many ball positions were seen and how well the physics model matched them. */
/** Physical sanity of a fitted flight. A low pixel residual alone does not prove the 3-D solution: one camera leaves speed and height partly ambiguous. */
export interface FlightPhysics { speedKph: number; releaseY: number; coverage: number; speedSigmaKph?: number }

/** The one refusal policy for every ball-flight figure, uploads and live alike. A short track cannot support a tight
 *  profile likelihood, so its uncertainty is floored; the jackknife (each quarter of the track left out) catches systematic
 *  error the residual sigma cannot see. Extra tracks found offline (hypotheses) must clear a higher bar than the main one. */
export function gateFlight(fr: FitResult, nObs: number, fps: number, hypothesis = false, cam?: CameraModel): { sigEff: number; confidence: number; warnings: string[]; refuse: string | null } {
  // A low camera looks almost along the ball's path, so speed and distance trade off: on synthetic deliveries a 1.3 m tripod
  // read 4-5 km/h low at 480 and 1280 px while every residual looked tight, and 2.4 m read within 1 km/h. Floor the uncertainty.
  const camH = cam ? cameraCentre(cam).z : null, lowCam = camH !== null && camH > 0 && camH < 2;
  const sigEff = Math.max(fr.speedSigmaKph, fr.jackSigmaKph ?? 0, nObs < 16 ? (fps < 45 ? 20 : 8) : nObs < 25 ? 3 : 0, lowCam ? 5 : 0);
  const ys = fr.samples.map((q) => q.p.y), cov = ys.length ? Math.max(0, Math.min(1, (Math.max(...ys) - Math.min(...ys)) / 20.12)) : 0;
  const fc = flightConfidence(nObs, fr.rmsPx, fps, { speedKph: fr.speedMs * 3.6, releaseY: fr.release.y, coverage: cov, speedSigmaKph: sigEff });
  let refuse: string | null = null;
  if (fr.rmsPx > 8) refuse = `The tracked points do not follow a ball flight (fit error ${fr.rmsPx.toFixed(0)} px). This usually means the camera moved or zoomed, or something other than the ball was followed.`;
  else if (fc.confidence < (hypothesis ? 0.5 : 0.35) || sigEff > 20) refuse = `Too uncertain to report (confidence ${(fc.confidence * 100).toFixed(0)}%, speed ±${sigEff.toFixed(0)} km/h): ${fc.warnings.slice(0, 2).join(" ")}`;
  if (lowCam) fc.warnings.push(`The camera is about ${camH!.toFixed(1)} m high. From below about 2 m one camera cannot fully separate the ball's speed from its distance, so speed is uncertain by about ±5 km/h. Raise the camera to 2-2.5 m for tighter figures.`);
  return { sigEff, confidence: fc.confidence, warnings: fc.warnings, refuse };
}

export function flightConfidence(trackPoints: number, rmsPx: number, fps: number, phys?: FlightPhysics): { confidence: number; warnings: string[] } {
  const w: string[] = [];
  let c = 1;
  if (phys) {
    if (phys.speedKph < 45 || phys.speedKph > 175) { c -= 0.5; w.push(`The fitted speed (${Math.round(phys.speedKph)} km/h) is outside what a cricket delivery can be, so the speed, line and length are not reliable.`); }
    else if (phys.speedKph < 60) { c -= 0.1; w.push("The fitted speed is very low for a delivery; check the calibration."); }
    if (phys.speedSigmaKph !== undefined) {
      if (phys.speedSigmaKph > 12) { c -= 0.35; w.push(`The speed is poorly determined by this track (about ±${Math.round(phys.speedSigmaKph)} km/h). Treat it as a rough figure.`); }
      else if (phys.speedSigmaKph > 6) { c -= 0.15; w.push(`The speed is uncertain by about ±${Math.round(phys.speedSigmaKph)} km/h.`); }
    }
    if (phys.releaseY < -3 || phys.releaseY > 6) { c -= 0.3; w.push("The fitted release point is not near the bowler's end, so the flight solution is doubtful."); }
    if (phys.coverage < 0.35) { c -= 0.25; w.push(`Only ${Math.round(phys.coverage * 100)}% of the flight was tracked, so speed and length are extrapolated.`); }
    else if (phys.coverage < 0.55) { c -= 0.1; w.push(`Only ${Math.round(phys.coverage * 100)}% of the flight was tracked.`); }
  }
  if (trackPoints < 8) { c -= 0.35; w.push(`Only ${trackPoints} ball positions were tracked, so speed and line are rough.`); }
  else if (trackPoints < 14) { c -= 0.15; w.push(`Only ${trackPoints} ball positions were tracked.`); }
  if (rmsPx > 6) { c -= 0.35; w.push(`The flight fit is loose (${rmsPx.toFixed(1)} px), so treat swing and spin as unreliable.`); }
  else if (rmsPx > 3) { c -= 0.15; w.push(`The flight fit is approximate (${rmsPx.toFixed(1)} px).`); }
  if (fps < 45) { c -= 0.1; w.push(`A ${Math.round(fps)} fps clip blurs the ball; 120 fps or more tracks it better.`); }
  return { confidence: clamp01(c), warnings: w };
}

export async function analyseClip(src: ClipSource, o: AnalyseOptions): Promise<AnalyseResult> {
  if (!o.cal) return analyseSwingsOnly(src, o);
  const model = buildCameraModel(o.cal);
  if (!model) throw new Error("Calibration failed: the four pitch corners must form a convex quadrilateral.");
  const { cfg } = o;
  const scale = src.analysisWidth / model.imageWidth;
  const dt = new DeliveryTracker(model, scale);
  const impacts = o.manualContact
    ? [{ tPerf: o.manualContact.t, peak: 0.25, ratio: 2, decayMs: 3, kind: o.manualContact.kind, precisionMs: 1000 / src.fps } as ImpactEvent]
    : [...o.impacts].sort((a, b) => a.tPerf - b.tPerf);
  const field = buildField(cfg, defaultFieldPreset(cfg));
  const balls: BallRecord[] = [], wagons: (WagonPoint | undefined)[] = [], diagnostics: DeliveryDiag[] = [], warnings: string[] = [];
  let score = newScore(cfg.format);
  const bowler: Skeleton[] = [], batter: Skeleton[] = [];
  const cuts = new CutDetector();
  let shotStart = o.range?.start ?? 0, tFirst: number | null = null, tLastF = 0;
  const stride = o.poseStride ?? Math.max(1, Math.round(src.fps / 30));
  const fit = o.fit ?? (async (c, obs, s) => fitFlightTo2D(c, obs, s));

  const finalize = async (tEnd: number) => { const tStart = dt.tStart; await analyseTrack(dt.take(), tStart, tEnd, false); };
  /** Fit one track and, if it passes as a ball flight, record the delivery. Hypotheses (offline extra tracks) leave no
   *  diagnostic when they fail: most of them are not balls. Returns true when a delivery was recorded. */
  const analyseTrack = async (raw: { t: number; x: number; y: number }[], tStart: number, tEnd: number, hypothesis: boolean): Promise<boolean> => {
    const idx = diagnostics.length + 1;
    const pts: TrackPt[] = raw.map((p) => ({ t: p.t, x: p.x / scale, y: p.y / scale }));
    const win = (a: Skeleton[]) => a.filter((s) => s.t >= Math.max(shotStart, tStart - 2.5) && s.t <= tEnd + 0.3);
    const hit = impacts.filter((e) => e.tPerf >= tStart - 0.1 && e.tPerf <= tEnd + 0.4).sort((a, b) => b.peak - a.peak)[0] ?? null;
    const contact: AnalysisQuality["contact"] = hit ? (o.manualContact ? "manual" : "audio") : "none";
    const diag: DeliveryDiag = { index: idx, tStart, tEnd, trackPoints: pts.length, analysed: false, contact, contactT: hit?.tPerf ?? null };
    if (!hypothesis) diagnostics.push(diag);
    const obs = fitObs({ track: pts, impact: hit });
    if (!obs) { diag.reason = "The ball was tracked for too few frames before contact to analyse."; return false; }
    const fr = await fit(model, obs, cfg.surface);
    if (!fr) { diag.reason = "The flight fit failed."; return false; }
    const gate = gateFlight(fr, obs.length, src.fps, hypothesis, model);
    if (gate.refuse && fr.rmsPx > 8) { diag.reason = gate.refuse; return false; }
    const res = buildLiveBall({ fit: fr, cfg, cam: model, field, score, index: balls.length, startedAt: Date.now(), bowlerFrames: win(bowler), batterFrames: win(batter), track: pts, impact: hit });
    if (!res) { diag.reason = "The delivery could not be assembled."; return false; }
    const r = res.record;
    // a short track cannot support a tight profile-likelihood: floor the uncertainty so a 13-point fit is never shown as +/-2 km/h
    // the fit's jackknife (each quarter of the track left out, refitted from this solution) catches systematic error the
    // residual-based sigma cannot see: texture under the ball, blur near the camera, another object for a few frames
    const q: AnalysisQuality = { trackPoints: obs.length, fitRmsPx: +fr.rmsPx.toFixed(2), speedSigmaKph: gate.sigEff, contact, bowlerPoseFrames: win(bowler).length, batterPoseFrames: win(batter).length, confidence: gate.confidence, warnings: gate.warnings };
    if (!hit) q.warnings.push("No bat or pad contact was found, so the shot, timing and batting numbers are not available. Mark the contact frame to add them.");
    if (cfg.mode !== "Batting Focus" && q.bowlerPoseFrames < 6) q.warnings.push("The bowler's body was not found often enough to measure the action.");
    if (cfg.mode !== "Bowling Focus" && hit && q.batterPoseFrames < 6) q.warnings.push("The batter's body was not found often enough to measure the swing and weight transfer.");
    // A figure this uncertain is not worth showing. Extra tracks found offline (hypotheses) are more often not balls, so they
    // have to clear a higher bar than the main track.
    if (gate.refuse) { diag.reason = gate.refuse; return false; }
    r.quality = q; r.synthetic = false;
    balls.push(r); wagons.push(res.wagon);
    score = applyOutcome(score, r.outcome, res.wagon);
    diag.analysed = true; diag.quality = q; if (hypothesis) { diag.index = diagnostics.length + 1; diagnostics.push(diag); }
    await o.onDelivery?.({ index: r.index, tStart, tEnd, track: pts, record: r, bowler: [...bowler], batter: [...batter], refToFrame });
    return true;
  };

  let k0 = o.range ? Math.max(0, Math.floor(o.range.start * src.fps)) : 0;
  let k1 = o.range ? Math.min(src.frameCount, Math.ceil(o.range.end * src.fps)) : src.frameCount;
  let motion: MotionTrack | null = null;
  if (o.cameraMotion === "compensate") {
    motion = await measureCameraMotion(src, k0, k1, o.calT ?? 0, o);
    if (o.signal?.aborted) return { balls, wagons, score, field, diagnostics, warnings, model, shots: [] };
    k0 = motion.kA; k1 = motion.kB;
    const pan = Math.max(...motion.toRef.map((z) => Math.hypot(z.tx, z.ty)));
    if (motion.zoomRange < 1.01 && pan < 1) {
      // the camera barely moved: removing "motion" that is really noise would only add error
      warnings.push("The camera did not zoom or pan in this shot, so no motion compensation was needed.");
      motion = null;
    } else warnings.push(`The camera zoomed ${motion.zoomRange.toFixed(1)}x and panned during this shot; its motion was measured and removed. Only the camera shot containing the calibration frame (${(k0 / src.fps).toFixed(1)}-${(k1 / src.fps).toFixed(1)} s) was analysed.`);
  }
  const zpFull = (z: ZoomPan): ZoomPan => ({ s: z.s, tx: z.tx / scale, ty: z.ty / scale });
  const refToFrame = motion ? (t: number) => zpFull(invertZP(motion!.toRef[Math.max(0, Math.min(motion!.toRef.length - 1, Math.round(t * src.fps) - motion!.kA))])) : undefined;
  for (let k = k0; k < k1; k++) {
    if (o.signal?.aborted) break;
    const wantPose = k % stride === 0;
    const toRef = motion ? motion.toRef[k - motion.kA] : undefined;
    const poseCam = motion && wantPose && o.cal ? buildCameraModel(mapCalibration(o.cal, zpFull(invertZP(toRef!)))) ?? undefined : undefined;
    const f = await src.frame(k, { pose: wantPose, poseCam });
    if (tFirst === null) tFirst = f.t; tLastF = f.t;
    // a camera cut ends whatever was being followed: a ball track or a pose window never spans two camera shots
    if (cuts.push(f.t, f.gray)) {
      if (dt.inDelivery) diagnostics.push({ index: diagnostics.length + 1, tStart: dt.tStart, tEnd: f.t, trackPoints: 0, analysed: false, contact: "none", contactT: null, reason: "The camera cut away during this delivery." });
      dt.reset(); shotStart = f.t;
    }
    dt.step(f.t, f.gray, src.fps, toRef);
    if (f.pose) {
      if (f.pose.bowler) bowler.push(f.pose.bowler);
      if (f.pose.batter) batter.push(f.pose.batter);
    }
    const lastImp = [...impacts].reverse().find((e) => e.tPerf <= f.t && e.tPerf >= dt.tStart - 0.1);
    if (dt.shouldFinalize(f.t, dt.inDelivery ? lastImp?.tPerf : undefined)) await finalize(Math.max(dt.tLast, lastImp?.tPerf ?? 0));
    if (k % 5 === 0) o.onProgress?.(k - k0, k1 - k0, `Frame ${k + 1} of ${k1}`);
  }
  if (dt.inDelivery && !o.signal?.aborted) await finalize(dt.tLast);
  // offline second chance: smooth tracks the main tracker never committed to (it was busy with a bowler's arm, say). Each is
  // fitted with the full flight model; only those that pass the same fit and confidence gates become deliveries.
  dt.flushHypotheses();
  const taken = diagnostics.filter((d) => d.analysed).map((d) => [d.tStart - 0.3, d.tEnd + 0.3]);
  for (const h of [...dt.hypotheses].sort((a, b) => b.length - a.length)) {
    if (o.signal?.aborted) break;
    const a = h[0].t, b = h[h.length - 1].t;
    if (taken.some(([x, y]) => a < y && b > x)) continue;
    if (await analyseTrack(h, a, b, true)) taken.push([a - 0.3, b + 0.3]);
  }
  if (dt.frames > 20 && dt.dupes / dt.frames > 0.05) {
    const m = `${Math.round((100 * dt.dupes) / dt.frames)}% of the frames in this clip are exact repeats (a frame-rate-converted or re-encoded file). Timing and positions are less exact, so speed can be off by 10-20 km/h. Use the original recording if you have it.`;
    warnings.push(m);
    for (const b of balls) if (b.quality) { b.quality.speedSigmaKph = Math.max(b.quality.speedSigmaKph ?? 0, 15); b.quality.confidence = Math.min(b.quality.confidence, 0.6); b.quality.warnings.push(m); }
  }
  if (dt.busyShare > 0.2 && !motion) {
    const m = `The picture changes between frames across ${Math.round(dt.busyShare * 100)}% of this clip, which happens with a panning or zooming camera and with heavy compression. Ball tracking needs a steady camera (tripod or fixed mount); speeds from this clip are unreliable.`;
    warnings.push(m);
    for (const b of balls) if (b.quality) { b.quality.confidence = Math.min(b.quality.confidence, 0.35); b.quality.warnings.push(m); }
  }
  // footage of a batter with no tracked ball: analyse each swing from the body alone
  if (cfg.mode !== "Bowling Focus" && batter.length >= 10) {
    const covered = (t: number) => balls.some((b) => b.batting && diagnostics.some((d) => d.analysed && t >= d.tStart - 0.5 && t <= d.tEnd + 0.8));
    // one camera shot at a time, so a swing is never stitched together from two different angles
    const edges = [-Infinity, ...cuts.cuts, Infinity];
    const sw: ReturnType<typeof swingRecords> = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const seg = batter.filter((b) => b.t >= edges[i] && b.t < edges[i + 1]);
      if (seg.length >= 10) sw.push(...swingRecords(seg, cfg.handedness, cfg, balls.length + sw.length, Date.now()).filter((x) => !covered(x.impactT)));
    }
    for (const x of sw) { balls.push(x.record); wagons.push(undefined); await o.onDelivery?.({ index: x.record.index, tStart: x.impactT - 1.2, tEnd: x.impactT + 0.4, track: [], record: x.record, bowler: [], batter: batter.filter((f) => f.t >= x.impactT - 2.5 && f.t <= x.impactT + 0.4) }); }
    if (sw.length) warnings.push(`${sw.length} swing${sw.length > 1 ? "s" : ""} analysed from the body alone (no ball tracked): weight transfer, bat speed and swing plane are measured; timing, shot and runs are not.`);
  }
  if (cuts.cuts.length) warnings.push(`This clip has ${cuts.cuts.length + 1} camera shots. Analysis restarted at every cut; the pitch calibration only fits the shot it was marked on, so deliveries in other shots are refused when they do not fit. Set the analysis range to one shot for ball tracking.`);
  if (!balls.length) warnings.push("No delivery was found. Check the calibration, that the ball is visible, and the slow-motion setting.");
  applyDisguiseScores(balls);
  o.onProgress?.(src.frameCount, src.frameCount, "Done");
  return { balls, wagons, score, field, diagnostics, warnings, model, shots: shotsFromCuts(cuts.cuts, tLastF + 1 / src.fps, 0.4, tFirst ?? 0) };
}

export interface MotionTrack { kA: number; kB: number; toRef: ZoomPan[]; zoomRange: number; maxErr: number }

/** Map a calibration through a zoom-pan (full-resolution pixels). */
export function mapCalibration(c: Calibration, z: ZoomPan): Calibration {
  const W = c.imageWidth, H = c.imageHeight, m = (p: { x: number; y: number }) => ({ x: z.s * (p.x - W / 2) + W / 2 + z.tx, y: z.s * (p.y - H / 2) + H / 2 + z.ty });
  return { ...c, corners: c.corners.map(m) as Calibration["corners"], stumpTop: c.stumpTop ? m(c.stumpTop) : c.stumpTop };
}

/**
 * Pass 1 for TV footage: frame-to-frame zoom and pan across [k0, k1), then the camera shot that holds the calibration frame,
 * then each frame's map into the calibration frame's coordinates (analysis pixels).
 */
export async function measureCameraMotion(src: ClipSource, k0: number, k1: number, calT: number, o: { signal?: { aborted: boolean }; onProgress?: (k: number, n: number, note: string) => void }): Promise<MotionTrack> {
  // Frame-to-frame estimates are accurate locally but chaining hundreds of them drifts, so each frame is also registered
  // directly against the frame SPAN back (predicted by the chain, then refined): drift then grows SPAN times more slowly.
  const SPAN = 6;
  const cuts = new CutDetector(), step: ZoomPan[] = [], span: (ZoomPan | null)[] = [], cutK: number[] = [], hist: Gray[] = [];
  let last: ZoomPan = IDENTITY, maxErr = 0;
  for (let k = k0; k < k1 && !o.signal?.aborted; k++) {
    const f = await src.frame(k, { pose: false });
    const isCut = cuts.push(f.t, f.gray); if (isCut) cutK.push(k);
    const prev = hist[hist.length - 1];
    let m = IDENTITY;
    if (prev && !isCut) {
      let same = true; for (let i = 0; i < f.gray.data.length; i += 7) if (Math.abs(f.gray.data[i] - prev.data[i]) > 1) { same = false; break; }
      if (!same) {
        const e = estimateZoomPan(prev, f.gray, { guess: last });
        // motion below the estimate's own noise is no motion: otherwise a still camera accumulates a slow false zoom
        m = Math.abs(e.s - 1) < 0.0004 && Math.hypot(e.tx, e.ty) < 0.1 ? IDENTITY : { s: e.s, tx: e.tx, ty: e.ty };
        maxErr = Math.max(maxErr, e.err); last = m;
      }
    }
    step.push(isCut ? IDENTITY : m);
    let sp: ZoomPan | null = null;
    const lastCut = cutK.length ? cutK[cutK.length - 1] : -Infinity;
    if (hist.length >= SPAN && k - SPAN >= lastCut) {
      let pred = IDENTITY; for (let q = k - SPAN + 1; q <= k; q++) pred = composeZP(pred, step[q - k0]);
      const e = estimateZoomPan(hist[hist.length - SPAN], f.gray, { guess: pred, maxZoom: 0.02, maxPanFrac: 0.025 });
      sp = e.err >= 12 ? null : Math.abs(e.s - 1) < 0.0006 && Math.hypot(e.tx, e.ty) < 0.15 ? IDENTITY : { s: e.s, tx: e.tx, ty: e.ty };
    }
    span.push(sp);
    hist.push(f.gray); if (hist.length > SPAN) hist.shift();
    if (k % 5 === 0) o.onProgress?.(k - k0, k1 - k0, "Measuring the camera's zoom and pan…");
  }
  const refK = Math.max(k0, Math.min(k1 - 1, Math.round(calT * src.fps)));
  const kA = Math.max(k0, ...cutK.filter((c) => c <= refK)), kB = Math.min(k1, ...cutK.filter((c) => c > refK));
  const toRef: ZoomPan[] = new Array(kB - kA);
  toRef[refK - kA] = IDENTITY;
  for (let k = refK + 1; k < kB; k++) {   // k -> (k - SPAN) -> ref when the direct span is known, else k -> k-1 -> ref
    const sp = span[k - k0];
    toRef[k - kA] = sp && k - SPAN >= refK ? composeZP(invertZP(sp), toRef[k - SPAN - kA]) : composeZP(invertZP(step[k - k0]), toRef[k - 1 - kA]);
  }
  for (let k = refK - 1; k >= kA; k--) {   // k -> (k + SPAN) -> ref
    const sp = k + SPAN < kB ? span[k + SPAN - k0] : null;
    toRef[k - kA] = sp && k + SPAN <= refK ? composeZP(sp, toRef[k + SPAN - kA]) : composeZP(step[k + 1 - k0], toRef[k + 1 - kA]);
  }
  const ss = toRef.map((z) => z.s);
  return { kA, kB, toRef, zoomRange: Math.max(...ss) / Math.min(...ss), maxErr };
}

/** Batting-only path: camera shots, the batter's body each frame, swings per shot. No calibration and no ball. */
async function analyseSwingsOnly(src: ClipSource, o: AnalyseOptions): Promise<AnalyseResult> {
  const { cfg } = o;
  const warnings: string[] = [];
  const cuts = new CutDetector();
  const batter: Skeleton[] = [];
  let tFirst: number | null = null, tLastF = 0;
  const k0 = o.range ? Math.max(0, Math.floor(o.range.start * src.fps)) : 0;
  const k1 = o.range ? Math.min(src.frameCount, Math.ceil(o.range.end * src.fps)) : src.frameCount;
  const stride = o.poseStride ?? Math.max(1, Math.round(src.fps / 30));
  for (let k = k0; k < k1; k++) {
    if (o.signal?.aborted) break;
    const f = await src.frame(k, { pose: (k - k0) % stride === 0 });
    if (tFirst === null) tFirst = f.t; tLastF = f.t;
    if (cuts.push(f.t, f.gray)) src.newShot?.();
    if (f.pose?.batter) batter.push(f.pose.batter);
    if (k % 5 === 0) o.onProgress?.(k - k0, k1 - k0, `Frame ${k + 1} of ${k1}`);
  }
  const balls: BallRecord[] = [], rejected: string[] = [];
  let lrSwaps = 0;
  const edges = [-Infinity, ...cuts.cuts, Infinity];
  for (let i = 0; i < edges.length - 1 && !o.signal?.aborted; i++) {
    const seg = batter.filter((b) => b.t >= edges[i] && b.t < edges[i + 1]);
    if (seg.length < 10) continue;
    const first = detectSwings(seg)[0];
    const stanceBefore = first !== undefined ? first - 0.6 : undefined;
    const lr = fixLeftRight(seg, cfg.handedness, stanceBefore);
    if (lr.swapped) lrSwaps++;
    const al = alignToStance(lr.frames, cfg.handedness, BATTER_CREASE_Y, stanceBefore);
    const aligned = al;
    // the pitch direction measured against the camera's line of sight (+Y before alignment): near 0 = filmed front-on or from
    // behind, where weight transfer and swing path lie along the depth a single camera cannot see
    const axisDeg = stanceAxisToCameraDeg(lr.frames, cfg.handedness, stanceBefore);
    for (const x of swingRecords(aligned, cfg.handedness, cfg, balls.length, Date.now(), rejected)) {
      if (axisDeg < 35 && x.record.batting) {
        x.record.batting.unmeasured = [...new Set([...(x.record.batting.unmeasured ?? []), "weight" as const, "path" as const])];
        x.record.quality!.warnings.push(`This camera looks along the batter's stride (${Math.round(axisDeg)}° off the line of sight), so weight transfer and swing path are not measured: film side-on for those.`);
      }
      x.record.quality!.warnings.push("Batting-only mode: scale comes from the batter's height and direction from the stance, so lengths are approximate.");
      balls.push(x.record);
      await o.onDelivery?.({ index: x.record.index, tStart: x.impactT - 1.2, tEnd: x.impactT + 0.4, track: [], record: x.record, bowler: [], batter: aligned.filter((f) => f.t >= x.impactT - 2.5 && f.t <= x.impactT + 0.4) });
    }
  }
  if (cuts.cuts.length) warnings.push(`This clip has ${cuts.cuts.length + 1} camera shots; each was analysed on its own.`);
  if (lrSwaps) warnings.push(`The body tracker mixed up the batter's left and right in ${lrSwaps} shot${lrSwaps > 1 ? "s" : ""}; this was detected from the stance and corrected.`);
  if (rejected.length) {
    const why = [...new Set(rejected)].map((r) => `${r} (${rejected.filter((x) => x === r).length})`).join("; ");
    warnings.push(`${rejected.length} other movement${rejected.length > 1 ? "s" : ""} looked like swings but failed the checks and are not shown: ${why}.`);
  }
  const poseFrames = Math.ceil((k1 - k0) / stride);
  warnings.push(`Body found in ${batter.length} of ${poseFrames} frames analysed (${Math.round((100 * batter.length) / Math.max(1, poseFrames))}%).`);
  if (!batter.length) warnings.push("No batter was found. The batter needs to be fully in frame, head to feet.");
  else if (!balls.length) warnings.push("The batter was found but no full swing was seen. Slow-motion replays need the slow-motion setting; leaves and blocks with little bat movement are not counted as swings.");
  if (balls.length) warnings.push(`${balls.length} swing${balls.length > 1 ? "s" : ""} analysed from the body alone: bat speed, weight transfer, head movement and swing plane. Timing, shot and runs need the ball.`);
  o.onProgress?.(k1 - k0, k1 - k0, "Done");
  return { balls, wagons: balls.map(() => undefined), score: newScore(cfg.format), field: [], diagnostics: [], warnings, model: null, shots: shotsFromCuts(cuts.cuts, tLastF + 1 / src.fps, 0.4, tFirst ?? 0) };
}

export { toGray };
