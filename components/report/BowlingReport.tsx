"use client";
import { useMemo, useState } from "react";
import type { BallMovement, BallRecord, BowlerStyle } from "@/lib/types";
import { PITCH_LENGTH } from "@/lib/physics/constants";

const f = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toFixed(d));
const signed = (n: number, d = 0) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const isSpin = (s: BowlerStyle) => s === "Off-Spin" || s === "Leg-Spin";

type Path = BallMovement["actual"];

/** Top (x vs y) or side (y vs z) view of one delivery against the "normal" ball flown from the same release. */
function Trace({ m, view, rel }: { m: BallMovement; view: "top" | "side"; rel: BallRecord }) {
  const W = view === "top" ? 300 : 460, H = view === "top" ? 460 : 220, pad = 22;
  const xs = (p: Path[number]) => (view === "top" ? pad + ((p.x + 1.6) / 3.2) * (W - 2 * pad) : pad + (p.y / (PITCH_LENGTH + 0.4)) * (W - 2 * pad));
  const ys = (p: Path[number]) => (view === "top" ? pad + (p.y / (PITCH_LENGTH + 0.4)) * (H - 2 * pad) : H - pad - (p.z / 2.7) * (H - 2 * pad));
  const d = (path: Path) => path.map((p, i) => `${i ? "L" : "M"}${xs(p).toFixed(1)} ${ys(p).toFixed(1)}`).join(" ");
  const bounce = rel.bounceX !== null && rel.bounceYFromBatter !== null ? { x: rel.bounceX, y: PITCH_LENGTH - rel.bounceYFromBatter, z: 0.036 } : null;
  const end = m.actual[m.actual.length - 1], endB = m.baseline[m.baseline.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-pitch-900/60" role="img" aria-label={`${view} view of the delivery against a normal ball`}>
      {view === "top" ? (
        <>
          <rect x={xs({ x: -1.525, y: 0, z: 0 })} y={ys({ x: 0, y: 0, z: 0 })} width={xs({ x: 1.525, y: 0, z: 0 }) - xs({ x: -1.525, y: 0, z: 0 })} height={ys({ x: 0, y: PITCH_LENGTH, z: 0 }) - ys({ x: 0, y: 0, z: 0 })} fill="#c8b45a22" />
          {[-0.114, 0, 0.114].map((x) => <circle key={x} cx={xs({ x, y: PITCH_LENGTH, z: 0 })} cy={ys({ x, y: PITCH_LENGTH, z: 0 })} r={2.5} fill="#fff" />)}
          <text x={W / 2} y={12} textAnchor="middle" fontSize="10" fill="#ffffff66">bowler</text>
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="#ffffff66">batter (off side {"→"})</text>
        </>
      ) : (
        <>
          <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="#ffffff33" />
          <rect x={xs({ x: 0, y: PITCH_LENGTH, z: 0 }) - 2} y={ys({ x: 0, y: 0, z: 0.711 })} width={4} height={ys({ x: 0, y: 0, z: 0 }) - ys({ x: 0, y: 0, z: 0.711 })} fill="#fff" />
          <text x={pad} y={14} fontSize="10" fill="#ffffff66">bowler</text>
          <text x={W - pad} y={14} fontSize="10" textAnchor="end" fill="#ffffff66">batter</text>
        </>
      )}
      <path d={d(m.baseline)} fill="none" stroke="#ffffff88" strokeWidth={2} strokeDasharray="6 5" />
      <path d={d(m.actual)} fill="none" stroke="#b6ff3c" strokeWidth={2.6} strokeLinecap="round" />
      {bounce && <circle cx={xs(bounce)} cy={ys(bounce)} r={4} fill="#ffb347" />}
      {end && <circle cx={xs(end)} cy={ys(end)} r={4.5} fill="#b6ff3c" />}
      {endB && <circle cx={xs(endB)} cy={ys(endB)} r={4} fill="none" stroke="#ffffffaa" strokeWidth={1.5} />}
    </svg>
  );
}

export default function BowlingReport({ balls, style }: { balls: BallRecord[]; style: BowlerStyle }) {
  const rows = useMemo(() => balls.filter((b) => b.movement && b.speedKph), [balls]);
  const biggest = useMemo(() => rows.reduce<BallRecord | null>((best, b) => (!best || Math.abs(b.movement!.totalMoveCm) > Math.abs(best.movement!.totalMoveCm) ? b : best), null), [rows]);
  const [sel, setSel] = useState<number | null>(null);
  if (!rows.length) return null;
  const cur = rows.find((b) => b.index === (sel ?? biggest?.index)) ?? rows[0];
  const m = cur.movement!;
  const spin = isSpin(style);
  const moveWord = spin ? "Turn" : "Seam movement";
  const dirWord = (n: number, a: string, i: string) => (Math.abs(n) < 1.5 ? "none" : n > 0 ? a : i);
  const mv = rows.map((b) => b.movement!);
  const tiles: [string, string, string][] = [
    ["Average pace", `${f(avg(rows.map((b) => b.speedKph!)))} km/h`, `peak ${f(Math.max(...rows.map((b) => b.speedKph!)))}`],
    ["Swing in the air", `${f(avg(mv.map((x) => Math.abs(x.airSwingMaxCm))))} cm`, `max ${f(Math.max(...mv.map((x) => Math.abs(x.airSwingMaxCm))))} cm vs a normal ball`],
    [`${moveWord} off the pitch`, `${f(avg(mv.map((x) => Math.abs(x.turnCm))))} cm`, `max ${f(Math.max(...mv.map((x) => Math.abs(x.turnCm))))} cm vs a normal ball`],
    ["Float / dip", `${signed(avg(mv.map((x) => -x.pitchShiftM)), 2)} m`, "+ fuller than a plain ball, - shorter"],
  ];
  return (
    <section className="card space-y-4 break-inside-avoid">
      <div>
        <h3 className="text-lg font-bold">Bowling report: swing and {spin ? "spin" : "seam"} against a normal delivery</h3>
        <p className="text-xs text-white/50">
          Each delivery is compared with a plain ball (no swing, no spin) released from the same hand with the same speed and angle.
          Anything extra is what the bowler added: sideways drift in the air (swing), movement after pitching ({spin ? "turn" : "seam"}), and
          how much shorter or fuller the ball landed (float / dip). Sideways numbers are from the batter&apos;s view; <b>away</b> means toward the off side.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([k, v, s]) => <div key={k} className="stat"><div className="label !mb-0">{k}</div><div className="text-xl font-bold">{v}</div><div className="text-[11px] text-white/45">{s}</div></div>)}
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Choose a delivery">
        {rows.map((b) => <button key={b.index} role="tab" aria-selected={b.index === cur.index} className={`btn !px-2.5 !py-1 text-xs ${b.index === cur.index ? "!bg-lime-glow !text-black" : ""}`} onClick={() => setSel(b.index)}>#{b.index}</button>)}
      </div>
      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <Trace m={m} view="top" rel={cur} />
        <div className="space-y-3">
          <Trace m={m} view="side" rel={cur} />
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <div className="stat"><div className="label !mb-0">Ball {cur.index}</div><b>{f(cur.speedKph)} km/h</b><div className="text-[11px] text-white/45">{cur.length} · {cur.line}</div></div>
            <div className="stat"><div className="label !mb-0">Swing</div><b>{f(Math.abs(m.airSwingMaxCm))} cm {dirWord(m.airSwingMaxCm, "away", "in")}</b></div>
            <div className="stat"><div className="label !mb-0">{moveWord}</div><b>{f(Math.abs(m.turnCm))} cm {dirWord(m.turnCm, "away", "in")}</b><div className="text-[11px] text-white/45">{f(Math.abs(m.turnDeg), 1)}° direction change</div></div>
            <div className="stat"><div className="label !mb-0">Spin rate</div><b>{f(m.spinRpm)} rpm</b><div className="text-[11px] text-white/45">axis {f(m.spinAxisTiltDeg)}° from backspin</div></div>
            <div className="stat"><div className="label !mb-0">Total at stumps</div><b>{f(Math.abs(m.totalMoveCm))} cm {dirWord(m.totalMoveCm, "away", "in")}</b></div>
          </div>
          <p className="text-[11px] text-white/45"><span className="text-lime-glow">Green</span> = the real delivery, <span className="text-white/70">dashed grey</span> = the normal ball from the same release, <span className="text-amber-300">orange dot</span> = where it pitched.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-white/50"><tr>{["#", "Pace", "Length / line", "Swing", moveWord, "Spin", "Float / dip", "Bounce at stumps"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((b) => { const x = b.movement!; return (
              <tr key={b.index} className={`cursor-pointer border-t border-white/10 hover:bg-white/5 ${b.index === cur.index ? "bg-white/10" : ""}`} onClick={() => setSel(b.index)}>
                <td className="px-2 py-1">{b.index}</td><td className="px-2 py-1">{f(b.speedKph)} km/h</td><td className="px-2 py-1">{b.length} · {b.line}</td>
                <td className="px-2 py-1">{f(Math.abs(x.airSwingMaxCm))} cm {x.swingType === "Straight" ? "" : x.swingType.toLowerCase()}</td>
                <td className="px-2 py-1">{f(Math.abs(x.turnCm))} cm {x.turnType === "Straight" ? "" : x.turnType.toLowerCase()}</td>
                <td className="px-2 py-1">{x.spinRpm >= 50 ? `${f(x.spinRpm, 0)} rpm` : "-"}</td><td className="px-2 py-1">{signed(-x.pitchShiftM, 2)} m</td><td className="px-2 py-1">{f(b.bounceHeightCm)} cm</td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
