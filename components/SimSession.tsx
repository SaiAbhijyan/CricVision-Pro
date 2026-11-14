"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClipMeta, FieldPlayer, SessionConfig } from "@/lib/types";
import { advance, buildField, defaultFieldPreset, type SimBall } from "@/lib/sim/match-sim";
import { mulberry32 } from "@/lib/sim/rng";
import { newScore, type ScoreState } from "@/lib/rules/scoreboard";
import { buildSimClip, clipReason } from "@/lib/sim/clips";
import { finalizeSim, virtualCamera } from "@/lib/session";
import { liveCoach } from "@/lib/coach/client";
import Scoreboard, { WagonMini } from "./Scoreboard";
import FieldRadar from "./FieldRadar";
import ReplayCanvas from "./ReplayCanvas";

export default function SimSession({ cfg }: { cfg: SessionConfig }) {
  const router = useRouter();
  const seed = useRef((Date.now() & 0x7fffffff) >>> 0);
  const rng = useRef(mulberry32(seed.current));
  const startedAt = useRef(Date.now());
  const [field, setField] = useState<FieldPlayer[]>(() => buildField(cfg, defaultFieldPreset(cfg)));
  const [score, setScore] = useState<ScoreState>(() => newScore(cfg.format));
  const [balls, setBalls] = useState<SimBall[]>([]);
  const [auto, setAuto] = useState(false);
  const [coach, setCoach] = useState<{ text: string; source: string; ms: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const cam = useMemo(() => virtualCamera(), []);
  const history = useRef<string[]>([]);
  const total = score.rules.maxOvers * 6;
  const last = balls[balls.length - 1];
  const clip: ClipMeta | null = useMemo(() => (last ? buildSimClip(last, cam, "live", clipReason(last) ?? "Latest ball") : null), [last, cam]);

  const bowl = () => {
    if (score.inningsOver) return;
    const r = advance({ cfg, field, rng: rng.current, score, index: balls.length, total, skill: 0.65, startedAt: startedAt.current });
    setScore(r.score); setBalls((b) => [...b, r.ball]);
    void liveCoach(r.ball.record, history.current).then((c) => { history.current.push(c.text); setCoach(c); });
  };
  const bowlRef = useRef(bowl); bowlRef.current = bowl;
  useEffect(() => { if (!auto || score.inningsOver) return; const id = setInterval(() => bowlRef.current(), 3200); return () => clearInterval(id); }, [auto, score.inningsOver]);

  const finish = async () => {
    setSaving(true); setAuto(false);
    const id = `sim-${startedAt.current}`;
    await finalizeSim({ id, cfg, balls, score, field, startedAt: startedAt.current });
    router.push(`/report/${id}`);
  };

  const r = last?.record;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[1fr_1.1fr] [&>*]:min-w-0">
      <div className="space-y-4">
        <Scoreboard score={score} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={bowl} disabled={score.inningsOver}>Bowl next ball</button>
          <button className="btn" onClick={() => setAuto((a) => !a)}>{auto ? "Stop auto" : "Auto-play"}</button>
          <button className="btn-danger ml-auto" disabled={!balls.length || saving} onClick={finish}>{saving ? "Saving…" : "Finish & report"}</button>
        </div>
        {coach && <div className="card border-lime-glow/40"><div className="label">Live coach · {coach.source === "offline-rules" ? "offline rules" : coach.source} · {coach.ms} ms</div><p className="text-lg font-semibold">{coach.text}</p></div>}
        {r && (
          <div className="card text-sm">
            <div className="mb-2 font-bold">Ball {r.index} · {r.length} · {r.line} · {r.speedKph?.toFixed(0)} km/h</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="stat">Swing<br /><b>{r.swingCm?.toFixed(1)} cm</b></div>
              <div className="stat">Turn<br /><b>{r.turnDeg?.toFixed(1)}°</b></div>
              <div className="stat">Bounce ht<br /><b>{r.bounceHeightCm?.toFixed(0)} cm</b></div>
              <div className="stat">Shot<br /><b>{r.shot ?? "—"}</b></div>
              <div className="stat">Timing<br /><b>{r.timing ?? "—"}</b></div>
              <div className="stat">Exit<br /><b>{r.ballistics ? `${r.ballistics.exitSpeedKph.toFixed(0)} km/h @ ${r.ballistics.elevationDeg.toFixed(0)}°` : "—"}</b></div>
            </div>
            {r.outcome.notes.length > 0 && <p className="mt-2 text-white/60">{r.outcome.notes.join(" · ")}</p>}
            {r.flags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{r.flags.map((f) => <span key={f} className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">{f}</span>)}</div>}
          </div>
        )}
        {clip && <div className="card"><div className="label">Hawkeye tracer + skeleton replay</div><ReplayCanvas clip={clip} /></div>}
      </div>
      <div className="space-y-4">
        <FieldRadar field={field} onChange={setField} hand={cfg.handedness} boundary={cfg.boundaryRadius} wagon={score.wagon} shotPath={r?.outcome.shotPath?.map((p) => ({ x: p.x, y: p.y }))} />
        <div className="card flex items-center gap-4"><WagonMini score={score} /><p className="text-sm text-white/60">Wagon wheel: cyan = four, lime = six. Drag fielders on the radar between balls — the next delivery uses the new field.</p></div>
      </div>
    </div>
  );
}
