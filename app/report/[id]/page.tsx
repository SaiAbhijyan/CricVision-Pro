"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { ClipMeta, CoachReport } from "@/lib/types";
import { exportSessionJson, getClips, getSession, putSession, type StoredSession } from "@/lib/storage/idb";
import { fetchReport } from "@/lib/coach/client";
import { sessionStats } from "@/lib/analytics/aggregate";
import ExecutiveDebrief from "@/components/report/ExecutiveDebrief";
import ReplayReel from "@/components/report/ReplayReel";
import QualityBanner from "@/components/report/QualityBanner";
import BowlingReport from "@/components/report/BowlingReport";
import BatSwing from "@/components/report/BatSwing";
import BowlerAction from "@/components/report/BowlerAction";
import DrsReview from "@/components/report/DrsReview";
import { Beehive, FootworkWrist, PitchMap, ReleaseScatter, StressCurve, TimingMatrix, WagonWheel, WeightVsDrift } from "@/components/report/Charts";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<StoredSession | null | undefined>(undefined);
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [rep, setRep] = useState<CoachReport | null>(null);

  useEffect(() => {
    (async () => {
      const sess = await getSession(id).catch(() => undefined);
      if (!sess) { setS(null); return; }
      setS(sess); setClips(await getClips(id));
      if (sess.report) { setRep(sess.report); return; }
      const r = await fetchReport(sess);
      setRep(r); await putSession({ ...sess, report: r });
    })();
  }, [id]);

  const download = async () => {
    const blob = new Blob([await exportSessionJson(id)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cricvision-${id}.json`; a.click();
  };

  if (s === undefined) return <p className="text-white/50">Loading…</p>;
  if (s === null) return <p>Session not found on this device.</p>;
  const st = sessionStats(s.balls);
  const swings = s.balls.filter((b) => b.flags.includes("Swing only (no ball tracked)"));
  const swingOnly = swings.length > 0 && swings.length === s.balls.length;
  const bsw = swings.filter((b) => !b.batting?.unmeasured?.includes("batSpeed")), wsw = swings.filter((b) => !b.batting?.unmeasured?.includes("weight"));
  const avgBat = bsw.length ? bsw.reduce((a, b) => a + (b.batting?.batSpeedKph ?? 0), 0) / bsw.length : 0;
  const hasBat = s.balls.some((b) => b.batting), hasBowl = s.balls.some((b) => b.bowling);
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-black">Session report</h1>
        <span className="text-sm text-white/50">{new Date(s.startedAt).toLocaleString()} · {s.config.mode} · {s.mode === "sim" ? "simulated" : s.mode === "upload" ? "uploaded clip" : "live camera"}</span>
        <button className="btn ml-auto" onClick={download}>Export JSON</button><button className="btn-primary" onClick={() => window.print()}>Print / PDF</button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {(swingOnly ? [["Swings", String(swings.length)], ["Bat speed", bsw.length ? `${avgBat.toFixed(0)} km/h` : "—"], ["Front foot", wsw.length ? `${(wsw.reduce((a, b) => a + (b.batting?.frontFootPct ?? 0), 0) / wsw.length).toFixed(0)}%` : "—"], ["Head drift", `${(swings.reduce((a, b) => a + Math.abs(b.batting?.headDriftCm ?? 0), 0) / swings.length).toFixed(1)} cm`], ["Downswing", `${(swings.reduce((a, b) => a + (b.batting?.downswingMs ?? 0), 0) / swings.length).toFixed(0)} ms`], ["Swing arc", `${(swings.reduce((a, b) => a + (b.batting?.swingArcCm ?? 0), 0) / swings.length).toFixed(0)} cm`]] : [["Score", `${s.runs}/${s.wickets}`], ["Balls", String(st.legal)], ["Boundaries", String(st.boundaries)], ["Dot %", st.dotPct.toFixed(0)], ["Avg speed", `${st.avgKph.toFixed(0)} km/h`], ["Sweet-spot %", st.sweetPct.toFixed(0)]]).map(([k, v]) => <div key={k} className="stat"><div className="label !mb-0">{k}</div><div className="text-xl font-bold">{v}</div></div>)}
      </div>
      <QualityBanner mode={s.mode} balls={s.balls} />
      {rep ? <ExecutiveDebrief r={rep} /> : <div className="card text-sm text-white/60">Writing your dossier…</div>}
      <ReplayReel clips={clips} />
      {hasBowl && <BowlingReport balls={s.balls} style={s.config.bowlerStyle} />}
      {hasBowl && <BowlerAction balls={s.balls} />}
      <DrsReview balls={s.balls} />
      {hasBat && <BatSwing balls={s.balls} />}
      <div className="grid gap-4 md:grid-cols-2">
        {hasBat && <><WeightVsDrift balls={s.balls} /><FootworkWrist balls={s.balls} /><TimingMatrix balls={s.balls} /><WagonWheel balls={s.balls} /></>}
        {hasBowl && <><PitchMap balls={s.balls} /><Beehive balls={s.balls} /><ReleaseScatter balls={s.balls} /><StressCurve balls={s.balls} /></>}
      </div>
    </div>
  );
}
