"use client";
import { useRef, useState } from "react";
import type { FieldPlayer, Handedness } from "@/lib/types";
import { GROUND_CENTRE } from "@/lib/physics/ballistics";
import { PITCH_LENGTH } from "@/lib/physics/constants";
import { PRESET_NAMES, buildPreset, outsideCircleCount, type PresetName } from "@/lib/rules/field";
import type { WagonPoint } from "@/lib/rules/scoreboard";

interface Props { field: FieldPlayer[]; onChange: (f: FieldPlayer[]) => void; hand: Handedness; boundary: number; wagon?: WagonPoint[]; shotPath?: { x: number; y: number }[] }

/** Top-down radar. World x → screen x, world y → screen y (bowler's end at the top, batter near the centre-bottom). */
export default function FieldRadar({ field, onChange, hand, boundary, wagon = [], shotPath }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const R = boundary + 6;
  const toWorld = (e: React.PointerEvent) => {
    const el = svg.current!, p = el.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: q.x, y: q.y };
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const w = toWorld(e);
    const dx = w.x - GROUND_CENTRE.x, dy = w.y - GROUND_CENTRE.y, d = Math.hypot(dx, dy), max = boundary - 1;
    const k = d > max ? max / d : 1;
    onChange(field.map((f) => (f.id === drag ? { ...f, x: GROUND_CENTRE.x + dx * k, y: GROUND_CENTRE.y + dy * k } : f)));
  };
  const out = outsideCircleCount(field);
  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {PRESET_NAMES.map((p: PresetName) => <button key={p} className="btn" onClick={() => onChange(buildPreset(p, hand, boundary))}>{p}</button>)}
        <span className={`ml-auto text-xs ${out > 5 ? "text-red-400" : "text-white/50"}`}>{out} outside 30-yd circle</span>
      </div>
      <svg ref={svg} viewBox={`${GROUND_CENTRE.x - R} ${GROUND_CENTRE.y - R} ${2 * R} ${2 * R}`} className="w-full touch-none select-none rounded-xl bg-pitch-700" onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        <circle cx={GROUND_CENTRE.x} cy={GROUND_CENTRE.y} r={boundary} fill="#1b4a30" stroke="#fff" strokeOpacity=".5" strokeWidth=".5" />
        <circle cx={GROUND_CENTRE.x} cy={GROUND_CENTRE.y} r={27.43 * 0.99} fill="none" stroke="#fff" strokeOpacity=".25" strokeDasharray="1.5 1.5" strokeWidth=".3" />
        <rect x={-1.52} y={0} width={3.05} height={PITCH_LENGTH} fill="#c8a96a" opacity=".55" />
        {wagon.map((w, i) => {
          const a = (w.azimuthDeg * Math.PI) / 180, d = Math.min(boundary, w.distance);
          return <line key={i} x1={0} y1={PITCH_LENGTH} x2={Math.sin(a) * d} y2={PITCH_LENGTH + -Math.cos(a) * d} stroke={w.boundary === 6 ? "#b6ff3c" : w.boundary === 4 ? "#6ee7ff" : "#fff"} strokeOpacity=".7" strokeWidth={w.boundary ? 0.5 : 0.25} />;
        })}
        {shotPath && <polyline points={shotPath.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#ffd34d" strokeWidth=".5" />}
        {field.map((f) => (
          <g key={f.id} onPointerDown={(e) => { if (f.id === "WK" || f.id === "BWL") return; (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(f.id); }} style={{ cursor: f.id === "WK" || f.id === "BWL" ? "default" : "grab" }}>
            <circle cx={f.x} cy={f.y} r={f.keeper ? 1.5 : 1.8} fill={f.keeper ? "#ffd34d" : f.id === "BWL" ? "#6ee7ff" : "#b6ff3c"} stroke="#000" strokeWidth=".3" />
            <text x={f.x} y={f.y - 2.4} fontSize="2.6" textAnchor="middle" fill="#fff">{f.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
