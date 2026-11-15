/**
 * Offline clip analysis: the same ball tracking, pose, audio-impact and physics pipeline as the live camera, driven by a
 * `ClipSource` (an uploaded video in the browser, rendered frames in tests). It returns the same BallRecords, so the
 * scoreboard, report and replay screens treat an uploaded clip exactly like a live session.
 */
import type { AnalysisQuality, BallRecord, Calibration, CameraModel, ClipMeta, FieldPlayer, SessionConfig } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { fitFlightTo2D, type FitResult, type TrackObs } from "@/lib/physics/trackfit";
import { toGray, type Gray } from "@/lib/cv/ball-detector";
import type { Skeleton } from "@/lib/cv/skeleton";
import type { PosePair } from "@/lib/cv/pose";
import { DeliveryTracker } from "@/lib/live/delivery-tracker";
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
  frame(k: number, o: { pose: boolean }): Promise<ClipFrame>;
}

export interface ManualContact { t: number; kind: ImpactKind }

export interface AnalyseOptions {
  cfg: SessionConfig;
  cal: Calibration;
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
}

export interface DeliveryDiag {
  index: number; tStart: number; tEnd: number; trackPoints: number; analysed: boolean; reason?: string;
  contact: AnalysisQuality["contact"]; contactT: number | null; quality?: AnalysisQuality;
}

export interface AnalyseResult {
  balls: BallRecord[]; wagons: (WagonPoint | undefined)[]; score: ScoreState; field: FieldPlayer[]; diagnostics: DeliveryDiag[]; warnings: string[]; model: CameraModel;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Trust in the flight numbers from how many ball positions were seen and how well the physics model matched them. */
/** Physical sanity of a fitted flight. A low pixel residual alone does not prove the 3-D solution: one camera leaves speed and height partly ambiguous. */
export interface FlightPhysics { speedKph: number; releaseY: number; coverage: number; speedSigmaKph?: number }

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
  const stride = o.poseStride ?? Math.max(1, Math.round(src.fps / 30));
  const fit = o.fit ?? (async (c, obs, s) => fitFlightTo2D(c, obs, s));

  const finalize = async (tEnd: number) => {
    const tStart = dt.tStart, idx = diagnostics.length + 1;
    const pts: TrackPt[] = dt.take().map((p) => ({ t: p.t, x: p.x / scale, y: p.y / scale }));
    const win = (a: Skeleton[]) => a.filter((s) => s.t >= tStart - 2.5 && s.t <= tEnd + 0.3);
    const hit = impacts.filter((e) => e.tPerf >= tStart - 0.1 && e.tPerf <= tEnd + 0.4).sort((a, b) => b.peak - a.peak)[0] ?? null;
    const contact: AnalysisQuality["contact"] = hit ? (o.manualContact ? "manual" : "audio") : "none";
    const diag: DeliveryDiag = { index: idx, tStart, tEnd, trackPoints: pts.length, analysed: false, contact, contactT: hit?.tPerf ?? null };
    diagnostics.push(diag);
    const obs = fitObs({ track: pts, impact: hit });
    if (!obs) { diag.reason = "The ball was tracked for too few frames before contact to analyse."; return; }
    const fr = await fit(model, obs, cfg.surface);
    if (!fr) { diag.reason = "The flight fit failed."; return; }
    const res = buildLiveBall({ fit: fr, cfg, cam: model, field, score, index: balls.length, startedAt: Date.now(), bowlerFrames: win(bowler), batterFrames: win(batter), track: pts, impact: hit });
    if (!res) { diag.reason = "The delivery could not be assembled."; return; }
    const r = res.record;
    // a short track cannot support a tight profile-likelihood: floor the uncertainty so a 13-point fit is never shown as +/-2 km/h
    const sigEff = Math.max(fr.speedSigmaKph, obs.length < 16 ? 8 : obs.length < 25 ? 3 : 0);
    const ys = fr.samples.map((q) => q.p.y), cov = Math.max(0, Math.min(1, (Math.max(...ys) - Math.min(...ys)) / 20.12));
    const fc = flightConfidence(obs.length, fr.rmsPx, src.fps, { speedKph: fr.speedMs * 3.6, releaseY: fr.release.y, coverage: cov, speedSigmaKph: sigEff });
    const q: AnalysisQuality = { trackPoints: obs.length, fitRmsPx: +fr.rmsPx.toFixed(2), speedSigmaKph: sigEff, contact, bowlerPoseFrames: win(bowler).length, batterPoseFrames: win(batter).length, confidence: fc.confidence, warnings: fc.warnings };
    if (!hit) q.warnings.push("No bat or pad contact was found, so the shot, timing and batting numbers are not available. Mark the contact frame to add them.");
    if (cfg.mode !== "Batting Focus" && q.bowlerPoseFrames < 6) q.warnings.push("The bowler's body was not found often enough to measure the action.");
    if (cfg.mode !== "Bowling Focus" && hit && q.batterPoseFrames < 6) q.warnings.push("The batter's body was not found often enough to measure the swing and weight transfer.");
    r.quality = q; r.synthetic = false;
    balls.push(r); wagons.push(res.wagon);
    score = applyOutcome(score, r.outcome, res.wagon);
    diag.analysed = true; diag.quality = q;
    await o.onDelivery?.({ index: r.index, tStart, tEnd, track: pts, record: r, bowler: [...bowler], batter: [...batter] });
  };

  for (let k = 0; k < src.frameCount; k++) {
    if (o.signal?.aborted) break;
    const wantPose = k % stride === 0;
    const f = await src.frame(k, { pose: wantPose });
    dt.step(f.t, f.gray, src.fps);
    if (f.pose) {
      if (f.pose.bowler) bowler.push(f.pose.bowler);
      if (f.pose.batter) batter.push(f.pose.batter);
    }
    const lastImp = [...impacts].reverse().find((e) => e.tPerf <= f.t && e.tPerf >= dt.tStart - 0.1);
    if (dt.shouldFinalize(f.t, dt.inDelivery ? lastImp?.tPerf : undefined)) await finalize(Math.max(dt.tLast, lastImp?.tPerf ?? 0));
    if (k % 5 === 0) o.onProgress?.(k, src.frameCount, `Frame ${k + 1} of ${src.frameCount}`);
  }
  if (dt.inDelivery && !o.signal?.aborted) await finalize(dt.tLast);
  if (!balls.length) warnings.push("No delivery was found. Check the calibration, that the ball is visible, and the slow-motion setting.");
  applyDisguiseScores(balls);
  o.onProgress?.(src.frameCount, src.frameCount, "Done");
  return { balls, wagons, score, field, diagnostics, warnings, model };
}

export { toGray };
