"use client";
import { weightOk, batSpeedOk } from "@/lib/cv/biomech";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { BallRecord } from "@/lib/types";
import { Box } from "./Charts";

const T = { fill: "#ffffff99", fontSize: 11 };
const ax = { stroke: "#ffffff33", tick: T };
const tip = { contentStyle: { background: "#0c1d14", border: "1px solid #ffffff22" } };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Bat swing and weight transfer, per shot: how fast, from what angle, and where the body weight was. */
export default function BatSwing({ balls }: { balls: BallRecord[] }) {
  const sw = balls.filter((b) => b.batting?.swingDetected);
  if (!sw.length) return null;
  const bt = sw.map((b) => b.batting!);
  const bs = bt.filter((b) => batSpeedOk(b) && b.batSpeedKph > 5), ws = bt.filter(weightOk);
  const na = "not measured";
  const tiles: [string, string, string][] = [
    ["Bat speed", bs.length ? `${avg(bs.map((b) => b.batSpeedKph)).toFixed(0)} km/h` : na, bs.length ? `peak ${Math.max(...bs.map((b) => b.batSpeedKph)).toFixed(0)}` : "hands moved implausibly fast: check the slow-motion setting"],
    ["Attack angle", `${avg(bt.map((b) => b.attackAngleDeg)).toFixed(0)}°`, "+ upward through the ball"],
    ["Swing path", `${avg(bt.map((b) => b.swingPathDeg)).toFixed(0)}°`, "0 = straight, + across to leg"],
    ["Downswing", `${avg(bt.map((b) => b.downswingMs)).toFixed(0)} ms`, `${avg(bt.map((b) => b.swingArcCm)).toFixed(0)} cm arc`],
    ["Weight on front foot", ws.length ? `${avg(ws.map((b) => b.frontFootPct)).toFixed(0)}%` : na, ws.length ? "whole-body centre of gravity, at contact" : "this camera looks along the stride; film side-on to measure it"],
    ["Centre of gravity travel", ws.length ? `${avg(ws.map((b) => b.comShiftCm)).toFixed(0)} cm` : na, "head to toe, toward the bowler"],
    ["Head drift", `${avg(bt.map((b) => Math.abs(b.headDriftCm))).toFixed(1)} cm`, "off the line, average"],
  ];
  const curves = sw.filter((b) => weightOk(b.batting)).map((b) => b.batting!.weightSeries).filter((a) => a && a.length === 34);
  const wcurve = curves.length ? Array.from({ length: 34 }, (_, k) => ({ ms: Math.round(-450 + (550 * k) / 33), front: avg(curves.map((a) => a[k])), back: 100 - avg(curves.map((a) => a[k])) })) : [];
  const speedVsExit = sw.filter((b) => b.ballistics && batSpeedOk(b.batting)).map((b) => ({ x: b.batting!.batSpeedKph, y: b.ballistics!.exitSpeedKph, edge: b.timing === "Edge" }));
  const byLen = (["Yorker", "Full", "Good", "Short"] as const).map((len) => {
    const lb = sw.filter((b) => b.length === len && weightOk(b.batting));
    return { length: `${len} (${lb.length})`, front: avg(lb.map((b) => b.batting!.frontFootPct)) };
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
      {wcurve.length > 0 && (
        <div className="card">
          <h3 className="font-bold">Centre of gravity: where your weight goes</h3>
          <p className="mb-2 text-xs text-white/50">Every joint from head to toe carries its share of body mass (head 7%, trunk 43%, each thigh 14%, and so on). Their weighted centre is your centre of gravity; the chart shows how much of it sits over the front foot, from 450 ms before contact to 100 ms after. A rising line that peaks at contact is weight going through the ball.</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer><LineChart data={wcurve}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="ms" type="number" domain={[-450, 100]} ticks={[-450, -300, -150, 0, 100]} tickFormatter={(v: number) => `${v} ms`} {...ax} /><YAxis {...ax} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => `${v}%`} width={44} /><Tooltip {...tip} formatter={(v: number) => `${v.toFixed(0)}%`} /><ReferenceLine x={0} stroke="#ffb347" strokeDasharray="4 4" label={{ value: "contact", fill: "#ffb347", fontSize: 11 }} /><ReferenceLine y={50} stroke="#ffffff33" /><Line type="monotone" dataKey="front" name="Front foot" stroke="#b6ff3c" strokeWidth={3} dot={false} /><Line type="monotone" dataKey="back" name="Back foot" stroke="#6ee7ff" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
          </div>
        </div>
      )}
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
