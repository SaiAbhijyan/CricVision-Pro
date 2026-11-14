"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BallRecord, Calibration, CameraModel, ClipMeta, FieldPlayer, SessionConfig } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { BallDetector, BallTracker, toGray, type TrackPoint } from "@/lib/cv/ball-detector";
import { PoseTracker } from "@/lib/cv/pose";
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
  const [status, setStatus] = useState("Point the camera down the pitch from behind the batter's stumps.");
  const [score, setScore] = useState<ScoreState>(() => newScore(cfg.format));
  const [field, setField] = useState<FieldPlayer[]>(() => buildField(cfg, defaultFieldPreset(cfg)));
  const [coach, setCoach] = useState<string>("");
  const [tripod, setTripod] = useState(false);
  const [audio, setAudio] = useState<string>("");
  const [level, setLevel] = useState(0);
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
    const det = new BallDetector(model, scale), trk = new BallTracker();
    const pose = new PoseTracker(model);
    try { await pose.init(); } catch (e) { setStatus(`Pose model failed to load (${(e as Error).message}); ball tracking only.`); }
    const ring = new FrameRing<ImageBitmap>(FrameRing.forSeconds(6, 30), (f) => f.item.close());
    const bowler: Skeleton[] = [], batter: Skeleton[] = [];
    const imp = new ImpactDetector(cfg.audioOffsetMs); detector.current = imp;
    imp.onImpact = (e) => { impacts.current.push(e); impacts.current = impacts.current.slice(-8); };
    try { const a = await imp.start(); setAudio(`${a.mode} @ ${a.sampleRate} Hz`); } catch (e) { setAudio(`mic unavailable (${(e as Error).message})`); }
    setStatus("Live. Bowl when ready.");

    let n = 0, lastT = 0, fps = 30, inDel = false, tStart = 0, lastPt = 0, track: TrackPoint[] = [], alive = true, busy = false;
    const meter = setInterval(() => setLevel(imp.level), 100);
    const finalize = async (tEnd: number) => {
      inDel = false; busy = true;
      const pts: TrackPt[] = track.map((p) => ({ t: p.t, x: p.x / scale, y: p.y / scale }));
      const win = (a: Skeleton[]) => a.filter((s) => s.t >= tStart - 2.5 && s.t <= tEnd + 0.3);
      const hit = impacts.current.filter((e) => e.tPerf >= tStart - 0.1 && e.tPerf <= tEnd + 0.4).sort((a, b) => b.peak - a.peak)[0] ?? null;
      const obs = fitObs({ track: pts, impact: hit });
      const fit = obs ? await fitInWorker(model, obs, cfg.surface) : null;
      const res = buildLiveBall({ fit, cfg, cam: model, field: fieldRef.current, score: scoreRef.current, index: balls.current.length, startedAt: Date.now(), bowlerFrames: win(bowler), batterFrames: win(batter), track: pts, impact: hit });
      trk.reset(); track = []; impacts.current = [];
      if (!res) { setStatus("Delivery seen but the ball track was too short to analyse."); busy = false; return; }
      const r = res.record; balls.current.push(r);
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
      if (n % stride === 0 && !busy) {
        sg.drawImage(v, 0, 0, sw, sh);
        const cands = det.detect(toGray(sg.getImageData(0, 0, sw, sh)));
        const p = trk.step(t, cands, fps);
        if (p) { track.push(p); lastPt = t; if (!inDel && track.length >= 4) { inDel = true; tStart = track[0].t; } }
        if (n % (lowPower.current ? 8 : 2) === 0) { const sk = pose.detect(v, t); if (sk.bowler) bowler.push(sk.bowler); if (sk.batter) batter.push(sk.batter); while (bowler.length && bowler[0].t < t - 8) bowler.shift(); while (batter.length && batter[0].t < t - 8) batter.shift(); }
        if (n % Math.max(1, Math.round(fps / 30)) === 0) createImageBitmap(small).then((b) => ring.push(t, b)).catch(() => {});
        const lastImp = impacts.current[impacts.current.length - 1];
        if (inDel && ((!trk.active && t - lastPt > 0.5) || (lastImp && t - lastImp.tPerf > 1.0) || t - tStart > 3)) void finalize(Math.max(lastPt, lastImp?.tPerf ?? 0));
      }
      schedule();
    };
    const schedule = () => { const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (n: number, m: VideoFrameCallbackMetadata) => void) => number }; if (vv.requestVideoFrameCallback) vv.requestVideoFrameCallback(onFrame); else requestAnimationFrame((ts) => onFrame(ts)); };
    schedule();
    const prev = stop.current; stop.current = () => { prev(); alive = false; clearInterval(meter); imp.stop(); pose.close(); ring.clear(); };
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
          {phase === "calibrate" && <CalibrationOverlay width={dims.w} height={dims.h} onLock={(c) => void run(c)} />}
        </div>
        <p className="text-sm text-white/60">{status}</p>
        <div className="flex flex-wrap items-center gap-2">
          {phase === "idle" && <button className="btn-primary" onClick={startCamera}>Start camera</button>}
          {phase === "running" && <>
            <button className="btn" onClick={() => setTripod(true)}>Tripod / thermal saver</button>
            <button className="btn-danger ml-auto" disabled={!nBalls} onClick={finish}>Finish & report</button>
            <div className="flex items-center gap-2 text-xs text-white/50"><span>Mic {audio}</span><span className="inline-block h-2 w-24 overflow-hidden rounded bg-white/10"><span className="block h-full bg-lime-glow" style={{ width: `${level * 100}%` }} /></span></div>
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
