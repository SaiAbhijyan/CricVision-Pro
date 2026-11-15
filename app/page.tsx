"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SetupPanel, { DEFAULT_CONFIG } from "@/components/SetupPanel";
import type { SessionConfig } from "@/lib/types";
import { listSessions, type StoredSession } from "@/lib/storage/idb";

export default function Home() {
  const router = useRouter();
  const [cfg, setCfg] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [past, setPast] = useState<StoredSession[]>([]);
  useEffect(() => { try { const s = localStorage.getItem("cvp-config"); if (s) setCfg({ ...DEFAULT_CONFIG, ...JSON.parse(s) }); } catch {} listSessions().then(setPast).catch(() => {}); }, []);
  const go = (mode: "sim" | "live") => { localStorage.setItem("cvp-config", JSON.stringify(cfg)); sessionStorage.setItem("cvp-mode", mode); router.push(`/session?mode=${mode}`); };
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-black">Your pocket biomechanics coach</h1>
        <p className="mt-1 max-w-3xl text-white/60">On-device pose + ball tracking, a physics engine with MCC umpiring, and a dual-model AI coach. Configure the session, then run the virtual match simulator or the live camera.</p>
      </section>
      <SetupPanel cfg={cfg} onChange={setCfg} />
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" onClick={() => go("sim")}>Start virtual match simulator</button>
        <button className="btn" onClick={() => go("live")}>Start live camera session</button>
        <button className="btn" onClick={() => { localStorage.setItem("cvp-config", JSON.stringify(cfg)); router.push("/analyse"); }}>Analyse a video clip</button>
      </div>
      {past.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-bold">Past sessions</h2>
          <ul className="divide-y divide-white/10 text-sm">
            {past.map((s) => <li key={s.id} className="flex items-center justify-between py-2"><span>{new Date(s.startedAt).toLocaleString()} · {s.config.mode} · {s.runs}/{s.wickets} ({s.legalBalls} balls)</span><a className="btn" href={`/report/${s.id}`}>Open report</a></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
