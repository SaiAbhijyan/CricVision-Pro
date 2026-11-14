"use client";
import type { CoachReport } from "@/lib/types";

export default function ExecutiveDebrief({ r }: { r: CoachReport }) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-xl font-black">{r.headline}</h2>
        <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">{r.source === "offline-rules" ? "Offline rule engine" : "Gemini 4 Carbon"}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><h3 className="mb-1 font-bold text-lime-glow">What went right</h3><ul className="list-inside list-disc space-y-1 text-sm">{r.whatWentRight.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><h3 className="mb-1 font-bold text-red-400">What went wrong</h3><ul className="space-y-2 text-sm">{r.whatWentWrong.map((w, i) => <li key={i}><b>{w.issue}</b><br /><span className="text-white/70">Why: {w.rootCause}</span><br /><span className="text-white/50">Evidence: {w.evidence}</span></li>)}</ul></div>
      </div>
      <div><h3 className="mb-1 font-bold">3-drill training plan</h3><div className="grid gap-3 md:grid-cols-3">{r.drills.map((d, i) => <div key={i} className="stat"><div className="font-semibold">{i + 1}. {d.name}</div><div className="text-xs text-lime-glow">{d.targets}</div><p className="mt-1 text-sm text-white/70">{d.instructions}</p><div className="mt-1 text-xs text-white/50">{d.reps}</div></div>)}</div></div>
      {r.injuryRisks.length > 0 && <div><h3 className="mb-1 font-bold text-amber-300">Injury risk watch</h3><ul className="list-inside list-disc text-sm">{r.injuryRisks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    </section>
  );
}
