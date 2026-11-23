"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Calibration, Pt } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { virtualCalibration } from "@/lib/sim/virtual-camera";

const NAMES = ["Bowler-left", "Bowler-right", "Batter-right", "Batter-left"];

/** 10-second 4-corner calibration (pitch corners at the popping creases) + stump-top anchor, drawn over the live video. */
export default function CalibrationOverlay({ width, height, onLock, labels = NAMES, initial, controlsIn }: { width: number; height: number; onLock: (c: Calibration) => void; /** where to render the buttons, outside the video so they never cover the pitch (falls back to over the video) */ controlsIn?: HTMLElement | null; /** corner names in on-screen order (top-left, top-right, bottom-right, bottom-left) */ labels?: string[]; initial?: Calibration }) {
  // default handles: a phone main camera on the recommended rig (about 5 m behind the stumps, 2.2 m up: below 2 m speed and
  // distance blur together); the whole pitch is in frame there in landscape and portrait, and every handle starts inside it
  const init = useRef(clampCalibration(initial ?? virtualCalibration(width, height, "batter", { dist: 5, height: 2.2, focal: 0.73 }), width, height));
  const [corners, setCorners] = useState<Pt[]>(init.current.corners);
  const [top, setTop] = useState<Pt>(init.current.stumpTop);
  const [left, setLeft] = useState(10);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  // video pixels per screen pixel: handles and labels are sized on screen (a 44 px touch target), not in video pixels
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const upd = () => setK(el.clientWidth ? width / el.clientWidth : 1);
    upd(); const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect();
  }, [width]);

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

  const controls = (
    <div className={`${controlsIn ? "" : "absolute bottom-3 left-3 right-3 bg-black/70 "}flex flex-wrap items-center gap-3 rounded-lg p-3 text-sm`}>
      <span>Drag the 4 lime corners onto the pitch corners and the amber dot onto the top of the batter's middle stump.</span>
      {err && <span className="text-red-400">{err}</span>}
      <button className="btn-primary ml-auto" onClick={() => { setErr(null); setLeft(10); setRunning(true); }}>{running ? `Locking in ${left}s` : "Start 10 s countdown"}</button>
      <button className="btn" onClick={lock}>Lock now</button>
    </div>
  );
  const R = 22 * k, fs = 13 * k;   // screen px
  const grab = (i: number) => (e: React.PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); setLeft(10); };
  return (
    <div className="absolute inset-0">
      <svg ref={svg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full touch-none" onPointerMove={move} onPointerUp={() => setDrag(null)}>
        <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")} fill="#b6ff3c22" stroke="#b6ff3c" strokeWidth={2 * k} pointerEvents="none" />
        {corners.map((c, i) => <text key={`l${i}`} x={c.x + R} y={c.y - R * 0.6} fill="#fff" fontSize={fs} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3 * k }}>{labels[i] ?? NAMES[i]}</text>)}
        <text x={top.x + R} y={top.y + fs * 0.35} fill="#fff" fontSize={fs} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3 * k }}>Stump top (71.1 cm)</text>
        {corners.map((c, i) => <g key={i} onPointerDown={grab(i)} data-handle={i}><circle cx={c.x} cy={c.y} r={R} fill="transparent" /><circle cx={c.x} cy={c.y} r={7 * k} fill="#b6ff3c" stroke="#000" strokeWidth={1.5 * k} /></g>)}
        <g onPointerDown={grab(4)} data-handle={4}><circle cx={top.x} cy={top.y} r={R} fill="transparent" /><circle cx={top.x} cy={top.y} r={6 * k} fill="#ffd34d" stroke="#000" strokeWidth={1.5 * k} /></g>
      </svg>
      {controlsIn ? createPortal(controls, controlsIn) : controls}
    </div>
  );
}

/** Keep every handle at least 24 px inside the frame so it can always be grabbed. */
export function clampCalibration(c: Calibration, w: number, h: number): Calibration {
  const m = 24, cl = (p: Pt): Pt => ({ x: Math.min(w - m, Math.max(m, p.x)), y: Math.min(h - m, Math.max(m, p.y)) });
  return { ...c, corners: c.corners.map(cl) as Calibration["corners"], stumpTop: cl(c.stumpTop) };
}
