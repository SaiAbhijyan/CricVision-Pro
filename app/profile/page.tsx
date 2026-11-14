"use client";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listSessions, type StoredSession } from "@/lib/storage/idb";
import { batterDNA, bowlerDNA, type BatterDNA } from "@/lib/analytics/profile";

const T = { fill: "#ffffff99", fontSize: 11 };
const ax = { stroke: "#ffffff33", tick: T };
const tip = { contentStyle: { background: "#0c1d14", border: "1px solid #ffffff22" } };
const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "-");
const Stat = ({ k, v, s }: { k: string; v: string; s?: string }) => <div className="stat"><div className="label !mb-0">{k}</div><div className="text-xl font-bold">{v}</div>{s && <div className="text-[11px] text-white/45">{s}</div>}</div>;
const Bullets = ({ items, tone }: { items: string[]; tone: "good" | "bad" }) => (
  <ul className="space-y-1.5 text-sm">{items.map((t) => <li key={t} className="flex gap-2"><span className={tone === "good" ? "text-lime-glow" : "text-red-400"}>{tone === "good" ? "+" : "-"}</span><span>{t}</span></li>)}{!items.length && <li className="text-white/45">Not enough data yet.</li>}</ul>
);

/** Eight batter-relative scoring zones as a polar chart (straight at the top, off side on the right). */
function ZoneWheel({ zones }: { zones: BatterDNA["zones"] }) {
  const R = 110, C = 130;
  const max = Math.max(1, ...zones.map((z) => z.share));
  const names = ["Straight", "Cover", "Point", "Third man", "Behind", "Fine leg", "Square leg", "Midwicket"];
  return (
    <svg viewBox="0 0 260 260" className="mx-auto w-full max-w-xs" role="img" aria-label="Share of runs by scoring zone">
      <circle cx={C} cy={C} r={R} fill="#0c1d14" stroke="#ffffff22" /><circle cx={C} cy={C} r={R / 2} fill="none" stroke="#ffffff14" strokeDasharray="3 4" />
      {zones.map((z, i) => {
        const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180, a1 = ((i * 45 + 22.5 - 90) * Math.PI) / 180, r = 14 + (R - 14) * (z.share / max);
        const p = (a: number, rr: number) => `${C + rr * Math.cos(a)},${C + rr * Math.sin(a)}`;
        const mid = ((i * 45 - 90) * Math.PI) / 180;
        return (
          <g key={z.zone}>
            <path d={`M${C},${C} L${p(a0, r)} A${r},${r} 0 0 1 ${p(a1, r)} Z`} fill="#b6ff3c" fillOpacity={0.15 + 0.7 * (z.share / max)} stroke="#b6ff3c55" />
            <text x={C + (R + 2) * Math.cos(mid) * 0.82} y={C + (R + 2) * Math.sin(mid) * 0.82} fontSize="8.5" fill="#fff" textAnchor="middle" dominantBaseline="middle">{names[i]}</text>
            <text x={C + (R * 0.5) * Math.cos(mid)} y={C + (R * 0.5) * Math.sin(mid)} fontSize="9" fill="#fff" textAnchor="middle" dominantBaseline="middle" fontWeight="700">{z.share >= 1 ? `${z.share.toFixed(0)}%` : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ProfilePage() {
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);
  useEffect(() => { listSessions().then(setSessions).catch(() => setSessions([])); }, []);
  const bat = useMemo(() => batterDNA((sessions ?? []).filter((s) => s.config.mode !== "Bowling Focus")), [sessions]);
  const bowl = useMemo(() => bowlerDNA((sessions ?? []).filter((s) => s.config.mode !== "Batting Focus")), [sessions]);
  if (sessions === null) return <p className="text-white/50">Loading…</p>;
  const trend = bat.trend.points.map((p, i) => ({ n: i + 1, sweet: +p.sweetPct.toFixed(1), drift: +p.headDriftAbsCm.toFixed(1), sr: +p.strikeRate.toFixed(0), bat: +p.batSpeedKph.toFixed(0) }));
  const bTrend = bowl.trend.points.map((p, i) => ({ n: i + 1, kph: +p.avgKph.toFixed(1), acc: +p.accuracyPct.toFixed(0), eco: +p.economy.toFixed(2) }));
  const t = bat.technique;
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-3xl font-black">Player DNA</h1>
        <p className="mt-1 max-w-3xl text-white/60">What the app has learned about your game across every session on this device. It sharpens as you play: nothing here leaves your device.</p>
      </section>
      {!sessions.length && <div className="card text-white/70">No sessions yet. Play a simulator or live session and your profile will start to form here.</div>}
      {sessions.length > 0 && (
        <>
          <section className="card">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-[16rem] flex-1">
                <div className="label">Batting style</div>
                <div className="text-3xl font-black text-lime-glow">{bat.archetype}</div>
                <p className="mt-1 text-sm text-white/70">{bat.archetypeText}</p>
                <div className="mt-3 text-xs text-white/50">Confidence {f(bat.confidence * 100)}% · {bat.sessions} sessions · {bat.shots} shots{bat.confidence < 1 ? ". More sessions sharpen this." : ""}</div>
                <div className="mt-1 h-1.5 w-full max-w-xs rounded bg-white/10"><div className="h-full rounded bg-lime-glow" style={{ width: `${bat.confidence * 100}%` }} /></div>
              </div>
              <div className="grid flex-[2] grid-cols-2 gap-3 md:grid-cols-4">
                <Stat k="Strike rate" v={f(bat.strikeRate)} s="runs per 100 balls" />
                <Stat k="Boundary %" v={f(bat.boundaryPct)} />
                <Stat k="Dot %" v={f(bat.dotPct)} />
                <Stat k="Middled %" v={f(bat.controlPct)} s="of shots" />
                <Stat k="Aggression" v={f(bat.aggression)} s="0 to 100" />
                <Stat k="Consistency" v={f(bat.consistency)} s="0 to 100" />
                <Stat k="Footwork" v={bat.footwork.label} s={`${f(bat.footwork.frontFootPct)}% on front foot`} />
                <Stat k="Trend" v={bat.trend.label} s="timing + head position" />
              </div>
            </div>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="card"><h3 className="mb-1 font-bold">Where you score</h3><p className="mb-2 text-xs text-white/50">Share of runs by zone, from your own point of view.</p><ZoneWheel zones={bat.zones} /></section>
            <section className="card space-y-4">
              <div><h3 className="mb-1 font-bold text-lime-glow">Strengths</h3><Bullets items={bat.strengths} tone="good" /></div>
              <div><h3 className="mb-1 font-bold text-red-400">What opponents will target</h3><Bullets items={bat.weaknesses} tone="bad" /></div>
              <div><h3 className="mb-1 font-bold">Signature shots</h3><p className="text-sm text-white/70">{bat.signatureShots.length ? bat.signatureShots.map((s) => `${s.shot} (${s.runs} runs)`).join(" · ") : "Not enough shots yet."}</p></div>
            </section>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="card"><h3 className="mb-2 font-bold">Technique signature</h3>
              <table className="w-full text-sm"><tbody>
                {([["Head drift", `${f(t.headDriftCm.mean, 1)} ± ${f(t.headDriftCm.sd, 1)} cm`], ["Trigger to contact", `${f(t.triggerMs.mean)} ± ${f(t.triggerMs.sd)} ms`], ["Stride", `${f(t.strideCm.mean)} ± ${f(t.strideCm.sd)} cm`], ["Bat speed", `${f(t.batSpeedKph.mean)} ± ${f(t.batSpeedKph.sd)} km/h`], ["Attack angle", `${f(t.attackAngleDeg.mean)} ± ${f(t.attackAngleDeg.sd)}°`], ["Swing path", `${f(t.swingPathDeg.mean)} ± ${f(t.swingPathDeg.sd)}°`], ["Downswing", `${f(t.downswingMs.mean)} ± ${f(t.downswingMs.sd)} ms`]] as [string, string][]).map(([k, v]) => <tr key={k} className="border-t border-white/10"><td className="py-1.5 text-white/60">{k}</td><td className="py-1.5 text-right font-semibold">{v}</td></tr>)}
              </tbody></table>
              <p className="mt-2 text-xs text-white/45">A small spread (the number after ±) means a repeatable technique.</p>
            </section>
            <section className="card"><h3 className="mb-2 font-bold">Against pace and spin, by length</h3>
              <div className="mb-3 grid grid-cols-2 gap-3">{bat.vsPaceSpin.map((v) => <Stat key={v.kind} k={`vs ${v.kind}`} v={`SR ${f(v.strikeRate)}`} s={`${f(v.sweetPct)}% middled · ${v.dismissals} out · ${v.balls} balls`} />)}</div>
              <div className="grid grid-cols-4 gap-2">{bat.byLength.map((l) => <Stat key={l.length} k={l.length} v={`${f(l.sweetPct)}%`} s={`middled · ${l.shots} shots`} />)}</div>
            </section>
          </div>
          {trend.length >= 2 && (
            <section className="card"><h3 className="font-bold">How your game is changing</h3><p className="mb-2 text-xs text-white/50">One point per session, oldest first. You want timing up and head drift down.</p>
              <div className="h-64"><ResponsiveContainer><LineChart data={trend}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="n" {...ax} label={{ value: "session", position: "insideBottom", offset: -2, fill: "#ffffff66", fontSize: 11 }} /><YAxis yAxisId="l" {...ax} /><YAxis yAxisId="r" orientation="right" {...ax} /><Tooltip {...tip} /><Legend />
                <Line yAxisId="l" dataKey="sweet" name="Middled %" stroke="#b6ff3c" strokeWidth={2} /><Line yAxisId="r" dataKey="drift" name="Head drift cm" stroke="#ff7a59" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
            </section>
          )}
          {bowl.deliveries > 0 && (
            <section className="card space-y-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-[16rem] flex-1"><div className="label">Bowling profile</div><div className="text-2xl font-black text-lime-glow">{bowl.airSwingCm.type}{bowl.turnCm.type !== "Little movement" ? ` · ${bowl.turnCm.type.toLowerCase()}` : ""}</div><p className="mt-1 text-sm text-white/70">Stock ball: {bowl.stockLength.toLowerCase()} length, {bowl.stockLine.toLowerCase()} line. Confidence {f(bowl.confidence * 100)}% · {bowl.deliveries} deliveries.</p></div>
                <div className="grid flex-[2] grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat k="Pace" v={`${f(bowl.paceKph.mean)} km/h`} s={`± ${f(bowl.paceKph.sd, 1)}, max ${f(bowl.paceKph.max)}`} />
                  <Stat k="In the channel" v={`${f(bowl.accuracyPct)}%`} s="good length, off stump" />
                  <Stat k="Swing vs normal" v={`${f(bowl.airSwingCm.maxAbs)} cm max`} s={`${f(Math.abs(bowl.airSwingCm.mean))} cm average`} />
                  <Stat k="Movement off pitch" v={`${f(bowl.turnCm.maxAbs)} cm max`} s={`${f(Math.abs(bowl.turnCm.mean))} cm average`} />
                  <Stat k="Release spread" v={`${f(bowl.releaseSdCm.lateral, 1)} cm`} s="side to side" />
                  <Stat k="Economy" v={f(bowl.economy, 1)} s="runs per over" />
                  <Stat k="Fatigue" v={`-${f(Math.max(0, bowl.fatigue.paceDropKph), 1)} km/h`} s="first to last third" />
                  <Stat k="Trend" v={bowl.trend.label} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-1 font-bold text-lime-glow">Strengths</h3><Bullets items={bowl.strengths} tone="good" /></div><div><h3 className="mb-1 font-bold text-red-400">To work on</h3><Bullets items={bowl.weaknesses} tone="bad" /></div></div>
              {bTrend.length >= 2 && <div className="h-56"><ResponsiveContainer><LineChart data={bTrend}><CartesianGrid stroke="#ffffff14" /><XAxis dataKey="n" {...ax} /><YAxis yAxisId="l" {...ax} /><YAxis yAxisId="r" orientation="right" {...ax} /><Tooltip {...tip} /><Legend /><Line yAxisId="l" dataKey="kph" name="Avg pace km/h" stroke="#6ee7ff" strokeWidth={2} /><Line yAxisId="r" dataKey="acc" name="In channel %" stroke="#b6ff3c" strokeWidth={2} /></LineChart></ResponsiveContainer></div>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
