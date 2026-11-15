"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Calibration, ClipMeta, SessionConfig } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { PoseTracker } from "@/lib/cv/pose";
import { FrameRing } from "@/lib/cv/frame-ring";
import { fitInWorker } from "@/lib/live/fit-client";
import { buildLiveClip } from "@/lib/live/clip";
import { putClip, putSession } from "@/lib/storage/idb";
import { analyseClip, type DeliveryDiag } from "@/lib/upload/analyse";
import { orientCalibration, type CameraEnd } from "@/lib/upload/calibration";
import { SLOW_MO, snapFps, effectiveFps, estimateAnalysisSeconds, frameAtMediaTime, validateUpload, clipTime } from "@/lib/upload/media";
import { mp4Fps, fileReader } from "@/lib/upload/mp4";
import { VideoClipSource, audioImpacts, probeFps } from "@/lib/upload/video-source";
import type { ImpactEvent } from "@/lib/audio/transient";
import type { ImpactKind } from "@/lib/audio/onset-core";
import { buildField, defaultFieldPreset } from "@/lib/sim/match-sim";
import CalibrationOverlay from "./CalibrationOverlay";

const FPS_CHOICES = [24, 25, 30, 50, 60, 120, 240];
const LABELS: Record<CameraEnd, string[]> = {
  batter: ["Bowler-left", "Bowler-right", "Batter-right", "Batter-left"],
  bowler: ["Batter-right", "Batter-left", "Bowler-left", "Bowler-right"],
};
type Phase = "pick" | "setup" | "analysing" | "done";

export default function UploadSession({ cfg }: { cfg: SessionConfig }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const abort = useRef({ aborted: false });
  const file = useRef<File | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 1280, h: 720, dur: 0 });
  const [mediaFps, setMediaFps] = useState(30);
  const [fpsNote, setFpsNote] = useState("");
  const [slow, setSlow] = useState(1);
  const [end, setEnd] = useState<CameraEnd>("batter");
  const [contactMode, setContactMode] = useState<"audio" | "manual">("audio");
  const [manual, setManual] = useState<{ mediaT: number; kind: ImpactKind } | null>(null);
  const [now, setNow] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [progress, setProgress] = useState({ k: 0, n: 1, note: "" });
  const [diags, setDiags] = useState<DeliveryDiag[]>([]);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => () => { abort.current.aborted = true; if (url) URL.revokeObjectURL(url); }, [url]);

  const eff = effectiveFps(mediaFps, slow);
  const frames = Math.floor(dims.dur * mediaFps);

  const onPick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    const why = validateUpload(f);
    if (why) { setError(why); return; }
    if (url) URL.revokeObjectURL(url);
    file.current = f; setCal(null); setManual(null); setDiags([]); setMessages([]);
    setUrl(URL.createObjectURL(f)); setPhase("setup");
  };

  const onMeta = async () => {
    const v = video.current!;
    if (!v.videoWidth || !isFinite(v.duration)) { setError("That video could not be decoded by this browser. Try an MP4 (H.264) or WebM clip."); setPhase("pick"); return; }
    if (v.duration > 600) { setError("That clip is longer than 10 minutes. Trim it to the deliveries you want analysed."); setPhase("pick"); return; }
    setDims({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
    setFpsNote("Detecting frame rate…");
    // the container's sample table is exact; playback probing is only a fallback because a 60 Hz screen hides frames of a 120/240 fps file
    const cf = file.current ? await mp4Fps(file.current.size, fileReader(file.current)) : null;
    const f = cf ? snapFps(cf) : await probeFps(v);
    if (f) { setMediaFps(f); setFpsNote(`Detected ${f} fps in the file.`); }
    else setFpsNote("Could not detect the frame rate. Choose it below (30 is typical for phone video, 240 for slow-motion files).");
    v.currentTime = 0;
  };

  const seek = (t: number) => { const v = video.current; if (!v) return; v.pause(); v.currentTime = Math.max(0, Math.min(dims.dur, t)); setNow(v.currentTime); };
  const step = (n: number) => seek((frameAtMediaTime(now, mediaFps) + n + 0.5) / mediaFps);

  const model = useMemo(() => (cal ? buildCameraModel(orientCalibration(cal, end)) : null), [cal, end]);
  const canRun = !!cal && !!model && (contactMode === "audio" || !!manual);

  const run = async () => {
    if (!cal || !file.current || !video.current) return;
    abort.current = { aborted: false };
    setError(null); setPhase("analysing"); setProgress({ k: 0, n: frames, note: "Reading the audio track…" });
    const f = file.current, v = video.current, startedAt = Date.now(), sessionId = `upload-${startedAt}`;
    const oriented = orientCalibration(cal, end);
    const cam = buildCameraModel(oriented)!;
    let pose: PoseTracker | null = null;
    const ring = new FrameRing<ImageBitmap>(FrameRing.forSeconds(6, 32), (e) => e.item.close());
    try {
      let impacts: ImpactEvent[] = [], hasAudio = false;
      if (contactMode === "audio") { const a = await audioImpacts(f, slow, abort.current); impacts = a.impacts; hasAudio = a.hasAudio; }
      const notes: string[] = [];
      if (contactMode === "audio" && !hasAudio) notes.push("This clip has no readable audio track, so bat and pad contact could not be detected. Re-run and mark the contact frame yourself.");
      setProgress((p) => ({ ...p, note: "Loading body tracking…" }));
      for (const delegate of ["GPU", "CPU"] as const) {
        try { const p = new PoseTracker(cam, { delegate }); await p.init(); pose = p; break; } catch { /* try next delegate */ }
      }
      if (!pose) notes.push("Body tracking could not start in this browser, so only the ball flight was analysed.");
      const src = new VideoClipSource({ video: v, mediaFps, timeScale: slow, pose, ring });
      const clips: { meta: ClipMeta; frames: Blob[] }[] = [];
      const res = await analyseClip(src, {
        cfg, cal: oriented, impacts, signal: abort.current,
        manualContact: contactMode === "manual" && manual ? { t: clipTime(manual.mediaT, slow), kind: manual.kind } : null,
        poseStride: Math.max(1, Math.round(eff / 15)),
        fit: (c, obs, s) => fitInWorker(c, obs, s, 60000),
        onProgress: (k, n, note) => setProgress({ k, n, note }),
        onDelivery: async (d) => {
          const c = await buildLiveClip({ id: `${sessionId}-c${d.index}`, sessionId, ballIndex: d.record.index, reason: "Uploaded clip", cam, ring, t0: Math.max(d.tStart - 1.2, ring.oldest()?.t ?? 0), t1: d.tEnd + 2.8, bowler: d.bowler, batter: d.batter, track: d.track, hand: cfg.handedness }).catch(() => null);
          if (c) clips.push(c);
        },
      });
      if (abort.current.aborted) { setPhase("setup"); return; }
      setDiags(res.diagnostics); setMessages([...notes, ...res.warnings]);
      if (!res.balls.length) { setPhase("done"); return; }
      await putSession({ id: sessionId, startedAt, endedAt: Date.now(), config: cfg, balls: res.balls, runs: res.score.runs, wickets: res.score.wickets, legalBalls: res.score.legalBalls, mode: "upload", calibration: oriented, field: res.field.length ? res.field : buildField(cfg, defaultFieldPreset(cfg)) });
      for (const c of clips) await putClip(c.meta, c.frames);
      router.push(`/report/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis failed.");
      setPhase("setup");
    } finally { pose?.close(); ring.clear(); }
  };

  const pct = Math.min(100, Math.round((progress.k / Math.max(1, progress.n)) * 100));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Analyse a video clip</h1>
        <p className="text-sm text-white/60">The clip is decoded and analysed on this device. It is not uploaded anywhere.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {phase === "pick" && (
        <label className="flex h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 bg-white/5 text-center hover:bg-white/10">
          <span className="text-lg">Choose a video</span>
          <span className="text-sm text-white/55">Nets from behind the batter, a side-on phone clip or a broadcast clip. MP4, MOV or WebM.</span>
          <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm" className="sr-only" onChange={(e) => onPick(e.target.files?.[0])} />
        </label>
      )}

      {phase !== "pick" && url && (
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
              <video ref={video} src={url} muted playsInline preload="auto" className="h-full w-full" onLoadedMetadata={onMeta} onError={() => { setError("That file could not be opened as a video by this browser. Try an MP4 (H.264) or WebM clip."); setPhase("pick"); }} onSeeked={() => setNow(video.current?.currentTime ?? 0)} />
              {calibrating && <CalibrationOverlay width={dims.w} height={dims.h} labels={LABELS[end]} initial={cal ?? undefined} onLock={(c) => { setCal(c); setCalibrating(false); }} />}
            </div>
            {phase === "setup" && (
              <div className="space-y-2">
                <input aria-label="Scrub the clip" type="range" min={0} max={dims.dur || 1} step={1 / mediaFps} value={now} onChange={(e) => seek(+e.target.value)} className="w-full" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button className="btn" onClick={() => step(-1)} aria-label="Back one frame">◀ frame</button>
                  <button className="btn" onClick={() => step(1)} aria-label="Forward one frame">frame ▶</button>
                  <span className="text-white/60">{now.toFixed(3)} s · frame {frameAtMediaTime(now, mediaFps)} of {frames}</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 text-sm">
            {phase === "setup" && (<>
              <fieldset className="space-y-2">
                <legend className="font-medium">1. Where was the camera?</legend>
                <select className="input w-full" value={end} onChange={(e) => { setEnd(e.target.value as CameraEnd); setCal(null); }}>
                  <option value="batter">Behind the batter, looking down the pitch</option>
                  <option value="bowler">Behind the bowler (broadcast style)</option>
                </select>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-medium">2. Speed of the clip</legend>
                <select className="input w-full" value={slow} onChange={(e) => setSlow(+e.target.value)}>{SLOW_MO.map((s) => <option key={s.label} value={s.timeScale}>{s.label}</option>)}</select>
                <label className="flex items-center gap-2">File frame rate
                  <select className="input" value={mediaFps} onChange={(e) => setMediaFps(+e.target.value)}>{[...new Set([...FPS_CHOICES, mediaFps])].sort((a, b) => a - b).map((f) => <option key={f} value={f}>{f}</option>)}</select>
                </label>
                <p className="text-white/55">{fpsNote} Real-time rate used for the physics: <b>{Math.round(eff)} fps</b>. A wrong slow-motion setting makes every speed wrong.</p>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-medium">3. Calibrate the pitch</legend>
                <p className="text-white/55">Scrub to a frame where the pitch corners and the batter's stumps are clear, then mark them.</p>
                <button className="btn" onClick={() => { seek(now); setCalibrating((c) => !c); }}>{calibrating ? "Cancel calibration" : cal ? "Re-calibrate on this frame" : "Calibrate on this frame"}</button>
                {cal && !calibrating && <p className="text-lime-300">Calibrated{model ? ` (error ${model.reprojErrorPx.toFixed(1)} px)` : ""}.</p>}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-medium">4. Bat or pad contact</legend>
                <label className="flex items-center gap-2"><input type="radio" checked={contactMode === "audio"} onChange={() => setContactMode("audio")} /> Find it from the sound</label>
                <label className="flex items-center gap-2"><input type="radio" checked={contactMode === "manual"} onChange={() => setContactMode("manual")} /> I will mark the contact frame</label>
                {contactMode === "manual" && (
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <button className="btn" onClick={() => setManual({ mediaT: now, kind: "bat-sweet" })}>Bat at this frame</button>
                      <button className="btn" onClick={() => setManual({ mediaT: now, kind: "pad-body" })}>Pad at this frame</button>
                    </div>
                    <p className="text-white/55">{manual ? `Marked ${manual.kind === "bat-sweet" ? "bat" : "pad"} contact at ${manual.mediaT.toFixed(3)} s.` : "Scrub to the frame where the ball meets the bat or pad, then mark it."}</p>
                  </div>
                )}
                <p className="text-white/55">Without contact the clip still gives the bowling numbers (speed, line, length). Batting numbers need contact.</p>
              </fieldset>
              <button className="btn-primary w-full" disabled={!canRun} onClick={run}>Analyse (about {estimateAnalysisSeconds(frames)} s)</button>
              <button className="btn w-full" onClick={() => { setPhase("pick"); setUrl(null); setCal(null); }}>Choose a different video</button>
            </>)}

            {phase === "analysing" && (
              <div className="space-y-3" role="status" aria-live="polite">
                <p>{progress.note || "Analysing…"}</p>
                <div className="h-2 overflow-hidden rounded bg-white/10"><div className="h-full bg-lime-400 transition-all" style={{ width: `${pct}%` }} /></div>
                <p className="text-white/55">{pct}% · frame {progress.k} of {progress.n}</p>
                <button className="btn" onClick={() => { abort.current.aborted = true; }}>Cancel</button>
              </div>
            )}

            {phase === "done" && (
              <div className="space-y-3">
                <p className="font-medium">No delivery could be analysed.</p>
                {messages.map((m, i) => <p key={i} className="text-white/70">{m}</p>)}
                {diags.map((d) => <p key={d.index} className="text-white/55">Track {d.index}: {d.trackPoints} ball positions. {d.reason ?? ""}</p>)}
                <ul className="list-disc pl-5 text-white/55"><li>Calibrate again, with the corners exactly on the crease lines.</li><li>Check the slow-motion setting and frame rate.</li><li>The ball must be visible against the pitch for at least half a second.</li></ul>
                <button className="btn-primary" onClick={() => setPhase("setup")}>Back to settings</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
