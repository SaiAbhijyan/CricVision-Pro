"use client";
import { useEffect, useRef, useState } from "react";
import type { Calibration, Pt } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { virtualCalibration } from "@/lib/sim/virtual-camera";

const NAMES = ["Bowler-left", "Bowler-right", "Batter-right", "Batter-left"];

/** 10-second 4-corner calibration (pitch corners at the popping creases) + stump-top anchor, drawn over the live video. */
export default function CalibrationOverlay({ width, height, onLock, labels = NAMES, initial }: { width: number; height: number; onLock: (c: Calibration) => void; /** corner names in on-screen order (top-left, top-right, bottom-right, bottom-left) */ labels?: string[]; initial?: Calibration }) {
  const init = useRef(initial ?? virtualCalibration(width, height));
  const [corners, setCorners] = useState<Pt[]>(init.current.corners);
  const [top, setTop] = useState<Pt>(init.current.stumpTop);
  const [left, setLeft] = useState(10);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const cal = (): Calibration => ({ corners: corners as Calibration["corners"], stumpTop: top, imageWidth: width, imageHeight: height });
  const lock = () => {
    const m = buildCameraModel(cal());
    if (!m) { setErr("Calibration failed — corners must form a convex quadrilateral."); return; }
    if (m.reprojErrorPx > 8) { setErr(`Reprojection error ${m.reprojErrorPx.toFixed(1)} px is too high; re-adjust the corners.`); setRunning(false); return; }
    onLock(cal());
  };
  useEffect(() => {
    if (!running) return;
    if (left <= 0) { lock(); return; }
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, left]);

  const pt = (e: React.PointerEvent): Pt => { const el = svg.current!, p = el.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(el.getScreenCTM()!.inverse()); return { x: q.x, y: q.y }; };
  const move = (e: React.PointerEvent) => { if (drag === null) return; const p = pt(e); if (drag < 4) setCorners((c) => c.map((x, i) => (i === drag ? p : x))); else setTop(p); };

  return (
    <div className="absolute inset-0">
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full touch-none" onPointerMove={move} onPointerUp={() => setDrag(null)}>
        <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")} fill="#b6ff3c22" stroke="#b6ff3c" strokeWidth={3} />
        {corners.map((c, i) => <g key={i} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); setLeft(10); }}><circle cx={c.x} cy={c.y} r={16} fill="#b6ff3c" /><text x={c.x + 20} y={c.y - 10} fill="#fff" fontSize={20}>{labels[i] ?? NAMES[i]}</text></g>)}
        <g onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(4); setLeft(10); }}><circle cx={top.x} cy={top.y} r={14} fill="#ffd34d" /><text x={top.x + 18} y={top.y + 6} fill="#fff" fontSize={20}>Stump top (71.1 cm)</text></g>
      </svg>
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-3 rounded-lg bg-black/70 p-3 text-sm">
        <span>Drag the 4 lime corners onto the pitch corners and the amber dot onto the top of the batter's middle stump.</span>
        {err && <span className="text-red-400">{err}</span>}
        <button className="btn-primary ml-auto" onClick={() => { setErr(null); setLeft(10); setRunning(true); }}>{running ? `Locking in ${left}s` : "Start 10 s countdown"}</button>
        <button className="btn" onClick={lock}>Lock now</button>
      </div>
    </div>
  );
}
