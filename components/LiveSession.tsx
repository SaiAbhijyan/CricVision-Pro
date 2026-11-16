"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BallRecord, Calibration, CameraModel, ClipMeta, FieldPlayer, SessionConfig } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { toGray } from "@/lib/cv/ball-detector";
import { DeliveryTracker } from "@/lib/live/delivery-tracker";
import { PoseTracker, startPose } from "@/lib/cv/pose";
import { FrameRing } from "@/lib/cv/frame-ring";
import type { Skeleton } from "@/lib/cv/skeleton";
import { ImpactDetector, type ImpactEvent } from "@/lib/audio/transient";
import { buildLiveBall, fitObs, type TrackPt } from "@/lib/live/pipeline";
import { fitInWorker } from "@/lib/live/fit-client";
import { buildLiveClip } from "@/lib/live/clip";
import { buildField, defaultFieldPreset, applyDisguiseScores } from "@/lib/sim/match-sim";
import { applyOutcome, newScore, type ScoreState } from "@/lib/rules/scoreboard";
import { liveCoach } from "@/lib/coach/client";
import { putClip, putSession } from "@/lib/storage/idb";
import { finishedSwings } from "@/lib/upload/swing";
import { gateFlight } from "@/lib/upload/analyse";
import Scoreboard from "./Scoreboard";
import FieldRadar from "./FieldRadar";
import CalibrationOverlay from "./CalibrationOverlay";
import TripodMode from "./TripodMode";

const SMALL_W = 480;

export default function LiveSession({ cfg }: { cfg: SessionConfig }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"idle" | "calibrate" | "running">("idle");
  const [dims, setDims] = useState({ w: 1280, h: 720 });
  const [status, setStatus] = useState("Set the phone about 5 m behind the batter's stumps and 2-2.5 m high, pointing down the pitch, with both sets of stumps in view.");
  const [score, setScore] = useState<ScoreState>(() => newScore(cfg.format));
  const [field, setField] = useState<FieldPlayer[]>(() => buildField(cfg, defaultFieldPreset(cfg)));
  const [coach, setCoach] = useState<string>("");
  const [tripod, setTripod] = useState(false);
  const [audio, setAudio] = useState<string>("");
  const [poseNote, setPoseNote] = useState<string>("loading body tracking…");
  const [level, setLevel] = useState(0);
  const [rate, setRate] = useState("");
  const [calSlot, setCalSlot] = useState<HTMLDivElement | null>(null);   // calibration buttons live below the video
  const [nBalls, setNBalls] = useState(0);

  const cal = useRef<Calibration | null>(null);
  const cam = useRef<CameraModel | null>(null);
  const balls = useRef<BallRecord[]>([]);
  const clips = useRef<{ meta: ClipMeta; frames: Blob[] }[]>([]);
  const scoreRef = useRef(score); scoreRef.current = score;
  const fieldRef = useRef(field); fieldRef.current = field;
  const lowPower = useRef(false); lowPower.current = tripod;
  const startedAt = useRef(Date.now());
  const impacts = useRef<ImpactEvent[]>([]);
  const detector = useRef<ImpactDetector | null>(null);
  const stop = useRef<() => void>(() => {});
  const history = useRef<string[]>([]);

  useEffect(() => () => stop.current(), []);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 120, min: 30 } }, audio: false });
      const v = video.current!; v.srcObject = s; await v.play();
      setDims({ w: v.videoWidth, h: v.videoHeight });
      const fps = s.getVideoTracks()[0].getSettings().frameRate ?? 30;
      setStatus(`Camera running at ~${Math.round(fps)} fps. Calibrate the pitch.`);
      setPhase("calibrate");
      const prev = stop.current; stop.current = () => { prev(); s.getTracks().forEach((t) => t.stop()); };
    } catch (e) { setStatus(`Camera unavailable: ${(e as Error).message}`); }
  };

  const run = useCallback(async (c: Calibration) => {
    const model = buildCameraModel(c)!; cam.current = model; cal.current = c;
    setPhase("running"); setStatus("Loading pose model…");
    const v = video.current!;
    const scale = SMALL_W / model.imageWidth, sw = SMALL_W, sh = Math.round(model.imageHeight * scale);
    const small = document.createElement("canvas"); small.width = sw; small.height = sh;
    const sg = small.getContext("2d", { willReadFrequently: true })!;
    const dt = new DeliveryTracker(model, scale);
    // ball tracking starts now; body tracking attaches when (if) the model loads, so a slow or broken GPU never blocks a session
    let pose: PoseTracker | null = null, alive = true;   // declared before any await: late callbacks read it
    void startPose(model).then((r) => { if (!r) { setPoseNote("body tracking unavailable on this device: ball tracking only"); return; } if (!alive) { r.pose.close(); return; } pose = r.pose; setPoseNote(`body tracking on (${r.delegate})`); });
    const ring = new FrameRing<ImageBitmap>(FrameRing.forSeconds(6, 30), (f) => f.item.close());
    const bowler: Skeleton[] = [], batter: Skeleton[] = [];
    const imp = new ImpactDetector(cfg.audioOffsetMs); detector.current = imp;
    imp.onImpact = (e) => { impacts.current.push(e); impacts.current = impacts.current.slice(-8); };
    try { const a = await imp.start(); setAudio(`${a.mode} @ ${a.sampleRate} Hz`); } catch (e) { setAudio(`mic unavailable (${(e as Error).message})`); }
    setStatus("Live. Bowl when ready.");

    let n = 0, lastT = 0, fps = 30, busy = false, lastSwingT = -Infinity, lastSwingCheck = 0;
    // throughput: frames the ball tracker saw per second; pose cost (EMA, ms) sets how often pose may run
    let procN = 0, poseN = 0, poseMs = 0, poseWarm = 0, rateAt = performance.now();
    const meter = setInterval(() => {
      setLevel(imp.level);
      const now = performance.now(); if (now - rateAt < 1000) return;
      const sec = (now - rateAt) / 1000; setRate(`tracking ${Math.round(procN / sec)} of ${Math.round(fps)} fps${pose ? ` · body ${Math.round(poseN / sec)} fps${poseMs > 100 ? " (this device is too slow for full body tracking: swing figures will be sparse)" : ""}` : ""}`); procN = 0; poseN = 0; rateAt = now;
    }, 100);
    const finalize = async (tEnd: number) => {
      busy = true;
      const tStart = dt.tStart;
      const pts: TrackPt[] = dt.take().map((p) => ({ t: p.t, x: p.x / scale, y: p.y / scale }));
      const win = (a: Skeleton[]) => a.filter((s) => s.t >= tStart - 2.5 && s.t <= tEnd + 0.3);
      const hit = impacts.current.filter((e) => e.tPerf >= tStart - 0.1 && e.tPerf <= tEnd + 0.4).sort((a, b) => b.peak - a.peak)[0] ?? null;
      impacts.current = impacts.current.filter((e) => e.tPerf > tEnd + 0.4);   // consume this ball's sounds now, before any await
      const obs = fitObs({ track: pts, impact: hit });
      const fit = obs ? await fitInWorker(model, obs, cfg.surface) : null;
      // same refusal policy as uploads: a figure the track cannot support is not shown
      const gate = fit && obs ? gateFlight(fit, obs.length, fps, false, model) : null;
      if (gate?.refuse) { setStatus(`Delivery seen, not scored: ${gate.refuse}`); return; }
      const res = buildLiveBall({ fit, cfg, cam: model, field: fieldRef.current, score: scoreRef.current, index: balls.current.length, startedAt: Date.now(), bowlerFrames: win(bowler), batterFrames: win(batter), track: pts, impact: hit });
      if (!res) { setStatus(!obs ? `Delivery seen but the ball was tracked in only ${pts.length} frames: too few to analyse.` : !fit ? "Delivery seen but the flight fit did not finish (this device may be too slow, or the track was not a ball)." : "Delivery seen but it could not be assembled."); return; }
      const r = res.record;
      if (gate && obs) r.quality = { trackPoints: obs.length, fitRmsPx: +fit!.rmsPx.toFixed(2), speedSigmaKph: gate.sigEff, contact: hit ? "audio" : "none", bowlerPoseFrames: win(bowler).length, batterPoseFrames: win(batter).length, confidence: gate.confidence, warnings: gate.warnings };
      balls.current.push(r);
      const ns = applyOutcome(scoreRef.current, r.outcome, res.wagon); setScore(ns); setNBalls(balls.current.length);
      const why = r.outcome.wicket ? `Wicket – ${r.outcome.wicket}` : r.outcome.boundary ? `Boundary ${r.outcome.boundary}` : r.flags[0] ?? null;
      if (why) {
        const clip = await buildLiveClip({ id: `live-${startedAt.current}-c${r.index}`, sessionId: `live-${startedAt.current}`, ballIndex: r.index, reason: why, cam: model, ring, t0: Math.max(tStart - 1.2, ring.oldest()?.t ?? 0), t1: tEnd + 2.8, bowler: [...bowler], batter: [...batter], track: pts, hand: cfg.handedness }).catch(() => null);
        if (clip) { r.clipId = clip.meta.id; clips.current.push(clip); }
      }
      void liveCoach(r, history.current).then((c) => { history.current.push(c.text); setCoach(`${c.text}  (${c.source === "offline-rules" ? "offline" : "AI"} · ${c.ms} ms)`); });
      busy = false;
    };
    const onFrame = (_now: number, meta?: VideoFrameCallbackMetadata) => {
      if (!alive) return;
      const t = ((meta as (VideoFrameCallbackMetadata & { captureTime?: number }) | undefined)?.captureTime ?? meta?.expectedDisplayTime ?? performance.now()) / 1000;
      if (lastT) fps = 0.9 * fps + 0.1 / Math.max(1e-3, t - lastT); lastT = t; n++;
      const stride = lowPower.current ? 4 : 1;
      if (n % stride === 0) {   // keep tracking while a delivery is fitted in the worker: the next ball can come quickly
        sg.drawImage(v, 0, 0, sw, sh);
        dt.step(t, toGray(sg.getImageData(0, 0, sw, sh)), fps);
        procN++;
        // ball first: pose may use about half the frame budget, so on a slow GPU it runs less often instead of starving the tracker
        const poseEvery = lowPower.current ? 8 : Math.max(2, Math.ceil((2 * poseMs * fps) / 1000));
        const poseBlocksBall = dt.inDelivery && poseMs > 1000 / fps;   // a slow pose call would drop frames from the ball's flight
        if (pose && n % poseEvery === 0 && !poseBlocksBall) { const p0 = performance.now(); const sk = pose.detect(v, t); const pm = performance.now() - p0; if (poseN + poseWarm > 0) poseMs = poseMs ? 0.8 * poseMs + 0.2 * pm : pm; else poseWarm = 1; poseN++; /* first call is GPU warm-up: not a cost sample */ if (sk) { if (sk.bowler) bowler.push(sk.bowler); if (sk.batter) batter.push(sk.batter); while (bowler.length && bowler[0].t < t - 8) bowler.shift(); while (batter.length && batter[0].t < t - 8) batter.shift(); } }
        // a swing with no ball tracked (shadow batting, throw-downs): analyse it from the body alone, once it has finished
        if (cfg.mode !== "Bowling Focus" && !dt.inDelivery && !busy && t - lastSwingCheck > 0.5 && batter.length >= 10) {
          lastSwingCheck = t;
          for (const x of finishedSwings(batter, cfg.handedness, cfg, Math.max(lastSwingT, dt.tLast), t, balls.current.length, Date.now())) {
            lastSwingT = x.impactT; balls.current.push(x.record); setNBalls(balls.current.length);
          }
        }
        if (n % Math.max(1, Math.round(fps / 30)) === 0) createImageBitmap(small).then((b) => ring.push(t, b)).catch(() => {});
        const lastImp = impacts.current[impacts.current.length - 1];
        if (!busy && dt.shouldFinalize(t, lastImp?.tPerf)) void finalize(Math.max(dt.tLast, lastImp?.tPerf ?? 0)).catch((e) => setStatus(`Could not analyse that delivery: ${(e as Error).message}`)).finally(() => { busy = false; });
      }
      schedule();
    };
    const schedule = () => { const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (n: number, m: VideoFrameCallbackMetadata) => void) => number }; if (vv.requestVideoFrameCallback) vv.requestVideoFrameCallback(onFrame); else requestAnimationFrame((ts) => onFrame(ts)); };
    schedule();
    const prev = stop.current; stop.current = () => { prev(); alive = false; clearInterval(meter); imp.stop(); pose?.close(); ring.clear(); };
  }, [cfg]);

  const finish = async () => {
    stop.current(); applyDisguiseScores(balls.current);
    const id = `live-${startedAt.current}`;
    await putSession({ id, startedAt: startedAt.current, endedAt: Date.now(), config: cfg, balls: balls.current, runs: score.runs, wickets: score.wickets, legalBalls: score.legalBalls, mode: "live", calibration: cal.current!, field });
    for (const c of clips.current) await putClip(c.meta, c.frames);
    router.push(`/report/${id}`);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} playsInline muted className="w-full" />
          {phase === "calibrate" && <CalibrationOverlay width={dims.w} height={dims.h} controlsIn={calSlot} onLock={(c) => { run(c).catch((e) => setStatus(`Could not start tracking: ${(e as Error).message}. Re-calibrate and try again.`)); }} />}
        </div>
        <div ref={setCalSlot} className="empty:hidden rounded-lg bg-black/40" />
        <p className="text-sm text-white/60">{status}</p>
        <div className="flex flex-wrap items-center gap-2">
          {phase === "idle" && <button className="btn-primary" onClick={startCamera}>Start camera</button>}
          {phase === "running" && <>
            <button className="btn" onClick={() => setTripod(true)}>Tripod / thermal saver</button>
            <button className="btn-danger ml-auto" disabled={!nBalls} onClick={finish}>Finish & report</button>
            <div className="flex items-center gap-2 text-xs text-white/50"><span>Mic {audio}</span><span data-testid="pose-note">· {poseNote}</span>{rate && <span data-testid="track-rate">· {rate}</span>}<span className="inline-block h-2 w-24 overflow-hidden rounded bg-white/10"><span className="block h-full bg-lime-glow" style={{ width: `${level * 100}%` }} /></span></div>
          </>}
        </div>
        {coach && <div className="card border-lime-glow/40"><div className="label">Live coach</div><p className="text-lg font-semibold">{coach}</p></div>}
      </div>
      <div className="space-y-4">
        <Scoreboard score={score} />
        <FieldRadar field={field} onChange={setField} hand={cfg.handedness} boundary={cfg.boundaryRadius} wagon={score.wagon} />
      </div>
      <TripodMode active={tripod} hud={`${score.runs}/${score.wickets} · ${nBalls} balls`} onExit={() => setTripod(false)} />
    </div>
  );
}
