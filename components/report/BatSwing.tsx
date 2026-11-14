"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { BallRecord } from "@/lib/types";
import { Box } from "./Charts";

const T = { fill: "#ffffff99", fontSize: 11 };
const ax = { stroke: "#ffffff33", tick: T };
const tip = { contentStyle: { background: "#0c1d14", border: "1px solid #ffffff22" } };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Bat swing and weight transfer, per shot: how fast, from what angle, and where the body weight was. */
export default function BatSwing({ balls }: { balls: BallRecord[] }) {
  const sw = balls.filter((b) => b.batting?.swingDetected && b.batting.batSpeedKph > 5);
  if (!sw.length) return null;
  const bt = sw.map((b) => b.batting!);
  const tiles: [string, string, string][] = [
    ["Bat speed", `${avg(bt.map((b) => b.batSpeedKph)).toFixed(0)} km/h`, `peak ${Math.max(...bt.map((b) => b.batSpeedKph)).toFixed(0)}`],
    ["Attack angle", `${avg(bt.map((b) => b.attackAngleDeg)).toFixed(0)}°`, "+ upward through the ball"],
    ["Swing path", `${avg(bt.map((b) => b.swingPathDeg)).toFixed(0)}°`, "0 = straight, + across to leg"],
    ["Downswing", `${avg(bt.map((b) => b.downswingMs)).toFixed(0)} ms`, `${avg(bt.map((b) => b.swingArcCm)).toFixed(0)} cm arc`],
    ["Weight on front foot", `${avg(bt.map((b) => b.frontFootPct)).toFixed(0)}%`, "at contact"],
    ["Weight shift", `${avg(bt.map((b) => b.weightShiftCm)).toFixed(0)} cm`, "hips toward the bowler"],
    ["Head drift", `${avg(bt.map((b) => Math.abs(b.headDriftCm))).toFixed(1)} cm`, "off the line, average"],
  ];
  const speedVsExit = sw.filter((b) => b.ballistics).map((b) => ({ x: b.batting!.batSpeedKph, y: b.ballistics!.exitSpeedKph, edge: b.timing === "Edge" }));
  const byLen = (["Yorker", "Full", "Good", "Short"] as const).map((len) => {
    const bs = sw.filter((b) => b.length === len);
    return { length: `${len} (${bs.length})`, front: avg(bs.map((b) => b.batting!.frontFootPct)) };
  });
  return (
    <section className="space-y-3">
      <div className="card">
        <h3 className="text-lg font-bold">Bat swing and weight transfer</h3>
        <p className="mb-3 text-xs text-white/50">Measured from the batter&apos;s hand path and feet through each shot. Bat speed is an estimate of the bat-head speed at contact; attack angle and path describe the shape of the swing.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
          {tiles.map(([k, v, s]) => <div key={k} className="stat"><div className="label !mb-0">{k}</div><div className="text-xl font-bold">{v}</div><div className="text-[11px] text-white/45">{s}</div></div>)}
        </div>
      </div>
      <div className="card">
        <h3 className="font-bold">Timing chain</h3>
        <p className="mb-2 text-xs text-white/50">Power flows hips, then shoulders, then hands. Each number is when that part moved fastest relative to contact (0 ms). Hands peaking close to 0 means the bat was at full speed at contact.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="stat"><div className="label !mb-0">Hips peak</div><div className="text-xl font-bold">{avg(bt.map((b) => b.hipPeakMs)).toFixed(0)} ms</div></div>
          <div className="stat"><div className="label !mb-0">Hands peak</div><div className="text-xl font-bold">{avg(bt.map((b) => b.handPeakMs)).toFixed(0)} ms</div></div>
          <div className="stat"><div className="label !mb-0">Chain in order</div><div className="text-xl font-bold">{Math.round((bt.filter((b) => b.chainOrdered).length / bt.length) * 100)}%</div><div className="text-[11px] text-white/45">of shots</div></div>
          <div className="stat"><div className="label !mb-0">Trigger to contact</div><div className="text-xl font-bold">{avg(bt.map((b) => b.triggerMs)).toFixed(0)} ms</div></div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Box title="Bat speed vs ball exit speed" note="Faster bat, faster ball: the points that sit low for their bat speed are mistimed or edged.">
          <ResponsiveContainer><ScatterChart><CartesianGrid stroke="#ffffff14" /><XAxis type="number" dataKey="x" name="Bat km/h" {...ax} domain={["auto", "auto"]} /><YAxis type="number" dataKey="y" name="Exit km/h" {...ax} domain={["auto", "auto"]} /><ZAxis range={[55, 55]} /><Tooltip {...tip} cursor={{ strokeDasharray: "3 3" }} /><Scatter data={speedVsExit.filter((p) => !p.edge)} fill="#b6ff3c" /><Scatter data={speedVsExit.filter((p) => p.edge)} fill="#ff6b6b" /></ScatterChart></ResponsiveContainer>
        </Box>
        <Box title="Weight transfer by length" note="Average share of body weight on the front foot at contact. Full balls want 70% or more; short balls want the weight back.">
          <ResponsiveContainer><BarChart data={byLen}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="length" {...ax} /><YAxis {...ax} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} width={44} /><Tooltip {...tip} formatter={(v: number) => `${v.toFixed(0)}%`} /><Bar dataKey="front" name="Front foot" fill="#6ee7ff" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </Box>
      </div>
    </section>
  );
}
