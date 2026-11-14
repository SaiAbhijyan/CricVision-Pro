"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Bar, BarChart } from "recharts";
import type { BallRecord } from "@/lib/types";
import { batSeries, beehive, pitchMap, releaseSlots, stressCurve, timingByLength, wagon } from "@/lib/analytics/aggregate";
import { PITCH_LENGTH } from "@/lib/physics/constants";

const T = { fill: "#ffffff99", fontSize: 11 };
const Box = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <div className="card break-inside-avoid"><h3 className="font-bold">{title}</h3>{note && <p className="mb-2 text-xs text-white/50">{note}</p>}<div className="h-64">{children}</div></div>
);
const ax = { stroke: "#ffffff33", tick: T };

export function WeightVsDrift({ balls }: { balls: BallRecord[] }) {
  const d = batSeries(balls).filter((p) => p.swing);
  return (
    <Box title="Weight transfer vs head drift" note="Front-foot weight % (left) and head drift in cm, + = toward off side (right). Drift while weight stays back explains edges.">
      <ResponsiveContainer><LineChart data={d}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="ball" {...ax} /><YAxis yAxisId="l" {...ax} domain={[0, 100]} /><YAxis yAxisId="r" orientation="right" {...ax} /><Tooltip contentStyle={{ background: "#0c1d14", border: "1px solid #ffffff22" }} /><Legend />
        <Line yAxisId="l" dataKey="frontFoot" name="Front-foot %" stroke="#b6ff3c" dot={false} strokeWidth={2} /><Line yAxisId="r" dataKey="headDrift" name="Head drift cm" stroke="#ff7a59" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer>
    </Box>
  );
}

export function FootworkWrist({ balls }: { balls: BallRecord[] }) {
  const d = batSeries(balls).filter((p) => p.swing).map((p) => ({ x: p.stride, y: p.wrist, ball: p.ball }));
  return (
    <Box title="Footwork–wrist correlation" note="Each dot is a swing: stride length (cm) vs wrist snap (°/s).">
      <ResponsiveContainer><ScatterChart><CartesianGrid stroke="#ffffff14" /><XAxis type="number" dataKey="x" name="Stride cm" {...ax} /><YAxis type="number" dataKey="y" name="Wrist °/s" {...ax} /><ZAxis range={[50, 50]} /><Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0c1d14", border: "1px solid #ffffff22" }} /><Scatter data={d} fill="#6ee7ff" /></ScatterChart></ResponsiveContainer>
    </Box>
  );
}

export function TimingMatrix({ balls }: { balls: BallRecord[] }) {
  const d = timingByLength(balls).map((r) => ({ ...r, length: `${r.length} (${r.n})` }));
  return (
    <Box title="Timing / shot matrix by length" note="Share of shots by contact quality for each length.">
      <ResponsiveContainer><BarChart data={d}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="length" {...ax} /><YAxis {...ax} domain={[0, 100]} unit="%" /><Tooltip contentStyle={{ background: "#0c1d14", border: "1px solid #ffffff22" }} /><Legend />
        <Bar dataKey="sweet" name="Sweet spot" stackId="a" fill="#b6ff3c" /><Bar dataKey="early" name="Early" stackId="a" fill="#ffd34d" /><Bar dataKey="late" name="Late" stackId="a" fill="#ff9f43" /><Bar dataKey="edge" name="Edge" stackId="a" fill="#ff5a5a" /><Bar dataKey="miss" name="Pad/miss" stackId="a" fill="#8b8b8b" /></BarChart></ResponsiveContainer>
    </Box>
  );
}

/** Top-down pitch map: where each ball pitched. Batter's end at the bottom, stumps drawn. */
export function PitchMap({ balls }: { balls: BallRecord[] }) {
  const d = pitchMap(balls), W = 220, H = 420, sx = (x: number) => W / 2 + (x / 1.8) * (W / 2), sy = (y: number) => 20 + (y / PITCH_LENGTH) * (H - 40);
  const zone = [["Yorker", 0, 2], ["Full", 2, 5], ["Good", 5, 8], ["Short", 8, 20.12]] as const;
  return (
    <div className="card break-inside-avoid"><h3 className="font-bold">Pitch map</h3><p className="mb-2 text-xs text-white/50">Bounce points (bowler at top). Red = wicket, lime = dot, white = runs.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-72">
        <rect x={sx(-1.52)} y={sy(0)} width={sx(1.52) - sx(-1.52)} height={sy(PITCH_LENGTH) - sy(0)} fill="#c8a96a33" />
        {zone.map(([n, a, b]) => <g key={n}><line x1={0} x2={W} y1={sy(PITCH_LENGTH - a)} y2={sy(PITCH_LENGTH - a)} stroke="#ffffff22" strokeDasharray="4 4" /><text x={4} y={sy(PITCH_LENGTH - (a + Math.min(b, 12)) / 2)} fill="#ffffff66" fontSize="10">{n}</text></g>)}
        {[-0.114, 0, 0.114].map((x) => <rect key={x} x={sx(x) - 1} y={sy(PITCH_LENGTH) - 3} width={2} height={6} fill="#fff" />)}
        {d.map((p) => <circle key={p.ball} cx={sx(p.x)} cy={sy(PITCH_LENGTH - p.yFromBatter)} r={5} fill={p.wicket ? "#ff5a5a" : p.dot ? "#b6ff3c" : "#fff"} fillOpacity={0.85}><title>{`Ball ${p.ball}: ${p.kph.toFixed(0)} km/h`}</title></circle>)}
      </svg></div>
  );
}

/** Beehive: where balls crossed the batter's stump plane (stumps outlined 22.86 cm × 71.1 cm). */
export function Beehive({ balls }: { balls: BallRecord[] }) {
  const d = beehive(balls), W = 260, H = 200, sx = (x: number) => W / 2 + x * 220, sy = (z: number) => H - 20 - z * 200;
  return (
    <div className="card break-inside-avoid"><h3 className="font-bold">Beehive</h3><p className="mb-2 text-xs text-white/50">Crossing point at the stumps (batter's view, off side to the right). Red = wicket.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-56">
        <line x1="0" x2={W} y1={sy(0)} y2={sy(0)} stroke="#ffffff44" />
        <rect x={sx(-0.114)} y={sy(0.711)} width={sx(0.114) - sx(-0.114)} height={sy(0) - sy(0.711)} fill="none" stroke="#fff" strokeWidth="1.5" />
        {d.map((p) => <circle key={p.ball} cx={sx(p.x)} cy={sy(Math.max(0, p.z))} r={4.5} fill={p.wicket ? "#ff5a5a" : p.dot ? "#b6ff3c" : "#6ee7ff"} fillOpacity={0.8}><title>{`Ball ${p.ball}`}</title></circle>)}
      </svg></div>
  );
}

export function ReleaseScatter({ balls }: { balls: BallRecord[] }) {
  const d = releaseSlots(balls).map((p) => ({ x: p.x * 100, y: p.z * 100, ball: p.ball }));
  return (
    <Box title="Release-slot scatter" note="Release point lateral position (cm) vs height (cm). A tight cluster means a hidden action; spread telegraphs variations.">
      <ResponsiveContainer><ScatterChart><CartesianGrid stroke="#ffffff14" /><XAxis type="number" dataKey="x" name="Lateral cm" {...ax} domain={["auto", "auto"]} /><YAxis type="number" dataKey="y" name="Height cm" {...ax} domain={["auto", "auto"]} /><ZAxis range={[60, 60]} /><Tooltip contentStyle={{ background: "#0c1d14", border: "1px solid #ffffff22" }} /><Scatter data={d} fill="#b6ff3c" /></ScatterChart></ResponsiveContainer>
    </Box>
  );
}

export function StressCurve({ balls }: { balls: BallRecord[] }) {
  const d = stressCurve(balls);
  return (
    <Box title="Stress curve" note="Front-knee angle at release and counter-rotation across the spell: fatigue shows as the knee collapsing while the back twists.">
      <ResponsiveContainer><LineChart data={d}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="ball" {...ax} /><YAxis yAxisId="l" {...ax} domain={[120, 185]} /><YAxis yAxisId="r" orientation="right" {...ax} /><Tooltip contentStyle={{ background: "#0c1d14", border: "1px solid #ffffff22" }} /><Legend />
        <Line yAxisId="l" dataKey="knee" name="Front knee °" stroke="#b6ff3c" dot={false} strokeWidth={2} /><Line yAxisId="r" dataKey="counter" name="Counter-rotation °" stroke="#ff7a59" dot={false} strokeWidth={2} /><Line yAxisId="r" dataKey="elbow" name="Elbow ext °" stroke="#6ee7ff" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer>
    </Box>
  );
}

export function WagonWheel({ balls }: { balls: BallRecord[] }) {
  const d = wagon(balls), R = 120;
  return (
    <div className="card break-inside-avoid"><h3 className="font-bold">Wagon wheel</h3><p className="mb-2 text-xs text-white/50">Shot direction from the batter; cyan = four, lime = six, red = caught.</p>
      <svg viewBox={`${-R - 10} ${-R - 10} ${2 * R + 20} ${2 * R + 20}`} className="mx-auto h-72"><circle r={R} fill="#12301f" stroke="#ffffff33" /><circle r={R * 0.42} fill="none" stroke="#ffffff22" strokeDasharray="4 4" /><rect x={-3} y={-R} width={6} height={R} fill="#c8a96a33" />
        {d.map((w) => { const a = (w.az * Math.PI) / 180, r = w.wicket ? R * 0.5 : w.boundary ? R : Math.min(R * 0.85, 20 + w.runs * 22); return <line key={w.ball} x1={0} y1={0} x2={r * Math.sin(a)} y2={-r * Math.cos(a)} stroke={w.wicket ? "#ff5a5a" : w.boundary === 6 ? "#b6ff3c" : w.boundary === 4 ? "#6ee7ff" : "#ffffffaa"} strokeWidth={w.boundary ? 2.4 : 1.4} />; })}
      </svg></div>
  );
}
