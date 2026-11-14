"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipMeta } from "@/lib/types";
import { BONES, JOINTS } from "@/lib/cv/skeleton";
import { WORLD_CORNERS, buildCameraModel, project } from "@/lib/physics/homography";
import { virtualCalibration } from "@/lib/sim/virtual-camera";
import { getFrame, hasFrames } from "@/lib/storage/idb";

/** Plays a stored highlight clip: skeletons for bowler + batter and the Hawkeye-style ball tracer, in slow motion. */
export default function ReplayCanvas({ clip, className }: { clip: ClipMeta; className?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [rate, setRate] = useState(0.25);
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState(0);
  const cam = useMemo(() => buildCameraModel(virtualCalibration(clip.width, clip.height)), [clip.width, clip.height]);
  const T = clip.overlays.length / clip.fps;
  const raf = useRef(0), last = useRef(0), t = useRef(0);
  const bitmaps = useRef<(ImageBitmap | null)[] | null>(null);

  // Live clips carry JPEG frames in IndexedDB: load them once. Simulated clips have none and are drawn on the virtual-camera backdrop.
  useEffect(() => {
    let dead = false; bitmaps.current = null;
    (async () => {
      if (!(await hasFrames(clip.id).catch(() => false))) return;
      const arr: (ImageBitmap | null)[] = [];
      for (let i = 0; i < clip.frameCount; i++) { const b = await getFrame(clip.id, i).catch(() => undefined); arr.push(b ? await createImageBitmap(b) : null); if (dead) return; }
      bitmaps.current = arr;
    })();
    return () => { dead = true; bitmaps.current?.forEach((b) => b?.close()); bitmaps.current = null; };
  }, [clip.id, clip.frameCount]);

  useEffect(() => {
    const draw = () => {
      const c = cv.current; if (!c) return; const g = c.getContext("2d")!;
      const i = Math.min(clip.overlays.length - 1, Math.floor(t.current * clip.fps));
      const ov = clip.overlays[i];
      g.clearRect(0, 0, c.width, c.height);
      const bm = bitmaps.current?.[i];
      if (bm) g.drawImage(bm, 0, 0, c.width, c.height);
      else if (cam) {
        g.fillStyle = "#0c1d14"; g.fillRect(0, 0, c.width, c.height);
        const poly = WORLD_CORNERS.map((p) => project(cam, { x: p.x, y: p.y, z: 0 })).filter(Boolean) as { x: number; y: number }[];
        if (poly.length === 4) { g.fillStyle = "#c8a96a55"; g.beginPath(); poly.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); }
        for (const [x, y] of [[0, 20.12], [0, 0]] as const) for (const dx of [-0.114, 0, 0.114]) { const a = project(cam, { x: x + dx, y, z: 0 }), b = project(cam, { x: x + dx, y, z: 0.711 }); if (a && b) { g.strokeStyle = "#f5f0e0"; g.lineWidth = 3; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); } }
      }
      // tracer up to the current frame
      g.lineWidth = 3; g.strokeStyle = "#ffd34d"; g.shadowColor = "#ffd34d"; g.shadowBlur = 10; g.beginPath();
      let started = false;
      for (let k = 0; k <= i; k++) { const b = clip.overlays[k].ball; if (!b) continue; if (!started) { g.moveTo(b.x, b.y); started = true; } else g.lineTo(b.x, b.y); }
      g.stroke(); g.shadowBlur = 0;
      if (ov.ball) { g.fillStyle = "#fff"; g.beginPath(); g.arc(ov.ball.x, ov.ball.y, 6, 0, 7); g.fill(); }
      // skeletons: [bowler 19][batter 19]
      const n = JOINTS.length;
      ([["#6ee7ff", 0], ["#b6ff3c", n]] as const).forEach(([col, off]) => {
        const lm = ov.landmarks; if (!lm || lm[off].x < 0) return;
        g.strokeStyle = col; g.lineWidth = 3;
        for (const [a, b] of BONES) { const p = lm[off + JOINTS.indexOf(a)], q = lm[off + JOINTS.indexOf(b)]; if (p.x < 0 || q.x < 0) continue; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
        g.fillStyle = col; for (let k = 0; k < n; k++) { const p = lm[off + k]; if (p.x >= 0) { g.beginPath(); g.arc(p.x, p.y, 3.5, 0, 7); g.fill(); } }
      });
      g.fillStyle = "#000a"; g.fillRect(0, 0, c.width, 34);
      g.fillStyle = "#fff"; g.font = "bold 16px system-ui"; g.fillText(`Ball ${clip.ballIndex} · ${clip.reason} · ${rate}× · t=${ov.t.toFixed(2)}s`, 10, 23);
    };
    const loop = (ts: number) => {
      if (playing) { const dt = last.current ? (ts - last.current) / 1000 : 0; t.current += dt * rate; if (t.current >= T) t.current = 0; setPos(t.current / T); }
      last.current = ts; draw(); raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [clip, cam, rate, playing, T]);

  return (
    <div className={className}>
      <canvas ref={cv} width={clip.width} height={clip.height} className="w-full rounded-lg bg-black" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        {[0.1, 0.25, 0.5, 1].map((r) => <button key={r} className={`btn ${rate === r ? "!bg-lime-glow !text-black" : ""}`} onClick={() => setRate(r)}>{r}×</button>)}
        <input type="range" min={0} max={1} step={0.001} value={pos} onChange={(e) => { t.current = +e.target.value * T; setPos(+e.target.value); }} className="min-w-[8rem] flex-1 accent-lime-400" />
      </div>
    </div>
  );
}
