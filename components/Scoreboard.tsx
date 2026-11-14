"use client";
import { crr, oversText, rrr, type ScoreState } from "@/lib/rules/scoreboard";

export function WagonMini({ score }: { score: ScoreState }) {
  // azimuth is clockwise from straight back down the ground (toward the bowler, top of the radar)
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36">
      <circle cx="70" cy="70" r="66" fill="#12301f" stroke="#ffffff22" />
      <circle cx="70" cy="70" r="30" fill="none" stroke="#ffffff22" strokeDasharray="3 3" />
      <rect x="67" y="10" width="6" height="60" fill="#c8a96a33" />
      {score.wagon.map((w, i) => {
        const a = (w.azimuthDeg * Math.PI) / 180, r = Math.min(64, (w.distance / 75) * 64);
        return <line key={i} x1="70" y1="70" x2={70 + r * Math.sin(a)} y2={70 - r * Math.cos(a)} stroke={w.boundary === 6 ? "#b6ff3c" : w.boundary === 4 ? "#6ee7ff" : "#ffffff88"} strokeWidth={w.boundary ? 1.6 : 0.9} />;
      })}
    </svg>
  );
}

export default function Scoreboard({ score }: { score: ScoreState }) {
  const r = rrr(score);
  return (
    <div className="card">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-4xl font-black tabular-nums">{score.runs}<span className="text-white/40">/{score.wickets}</span></div>
          <div className="text-sm text-white/60">{oversText(score.legalBalls)} / {score.rules.maxOvers} ov</div>
        </div>
        <div className="text-right text-sm">
          <div>CRR <b className="tabular-nums">{crr(score).toFixed(2)}</b></div>
          {r !== null && <div>RRR <b className="tabular-nums text-lime-glow">{r.toFixed(2)}</b> <span className="text-white/40">target {score.rules.target}</span></div>}
          {score.freeHit && <div className="mt-1 rounded bg-lime-glow px-2 py-0.5 text-xs font-bold text-black">FREE HIT</div>}
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => {
          const b = score.last[score.last.length - 6 + i];
          return <span key={i} className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${!b ? "bg-white/5 text-white/20" : b.wicket ? "bg-red-500" : b.runs >= 4 ? "bg-lime-glow text-black" : b.extra ? "bg-amber-500 text-black" : "bg-white/10"}`}>{b?.label ?? "·"}</span>;
        })}
      </div>
      {score.inningsOver && <div className="mt-2 text-sm font-semibold text-amber-300">Innings complete</div>}
    </div>
  );
}
