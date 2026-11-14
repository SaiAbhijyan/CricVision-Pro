"use client";
import { useState } from "react";
import type { BallRecord } from "@/lib/types";
import { STUMP_HALF, STUMP_HEIGHT, BALL_RADIUS } from "@/lib/physics/constants";

const zoneTone = (z: string) => (z === "In-Line" || z === "Hitting" ? "text-lime-glow" : z === "Umpire's Call" ? "text-amber-300" : "text-red-400");

/** Decision review for LBW appeals: where it pitched, where it hit the pad, would it hit the stumps, and the umpire's call band. */
export default function DrsReview({ balls }: { balls: BallRecord[] }) {
  const rows = balls.filter((b) => b.outcome.lbw);
  const [sel, setSel] = useState<number | null>(null);
  if (!rows.length) return null;
  const cur = rows.find((b) => b.index === (sel ?? rows[0].index)) ?? rows[0];
  const v = cur.outcome.lbw!;
  const W = 260, H = 200, sx = (x: number) => W / 2 + (x / 0.45) * (W / 2 - 20), sy = (z: number) => H - 20 - (z / 0.95) * (H - 40);
  const p = v.projectedAtStumps;
  const rad = (BALL_RADIUS / 0.45) * (W / 2 - 20);
  return (
    <section className="card space-y-3 break-inside-avoid">
      <div>
        <h3 className="text-lg font-bold">Decision review (LBW)</h3>
        <p className="text-xs text-white/50">Three checks, as in televised reviews: where it pitched, where it hit the pad, and whether the projected path would hit the stumps. If under half the ball would hit, it is &quot;umpire&apos;s call&quot; and the on-field decision stands. There is no umpire&apos;s call on where it pitched.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">{rows.map((b) => <button key={b.index} className={`btn !px-2.5 !py-1 text-xs ${b.index === cur.index ? "!bg-lime-glow !text-black" : ""}`} onClick={() => setSel(b.index)}>#{b.index}</button>)}</div>
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-pitch-900/60" role="img" aria-label="Stumps as seen from the bowler with the projected ball position">
          <line x1="10" x2={W - 10} y1={sy(0)} y2={sy(0)} stroke="#ffffff33" />
          {[-STUMP_HALF + 0.0114, 0, STUMP_HALF - 0.0114].map((x) => <rect key={x} x={sx(x) - 3} y={sy(STUMP_HEIGHT)} width={6} height={sy(0) - sy(STUMP_HEIGHT)} fill="#e8e2c8" />)}
          <rect x={sx(-STUMP_HALF - BALL_RADIUS)} y={sy(STUMP_HEIGHT + BALL_RADIUS)} width={sx(STUMP_HALF + BALL_RADIUS) - sx(-STUMP_HALF - BALL_RADIUS)} height={sy(0) - sy(STUMP_HEIGHT + BALL_RADIUS)} fill="#fbbf2418" stroke="#fbbf24" strokeDasharray="4 3" />
          {p && <circle cx={sx(p.x)} cy={sy(p.z)} r={rad} fill="#b6ff3c66" stroke="#b6ff3c" strokeWidth={1.5} />}
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#ffffff66">amber band = umpire&apos;s call (ball radius around the stumps)</text>
        </svg>
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div className="stat"><div className="label !mb-0">Pitching</div><b className={zoneTone(v.pitching)}>{v.pitching}</b></div>
            <div className="stat"><div className="label !mb-0">Impact</div><b className={zoneTone(v.impact)}>{v.impact}</b></div>
            <div className="stat"><div className="label !mb-0">Wickets</div><b className={zoneTone(v.wickets)}>{v.wickets}</b></div>
          </div>
          <div className="stat"><div className="label !mb-0">Decision</div><b className={v.decision === "OUT" ? "text-red-400" : "text-lime-glow"}>{v.decision}</b><div className="text-xs text-white/55">{v.reason}</div></div>
          <div className="grid grid-cols-3 gap-2 text-xs text-white/60">
            <div>Pitch to pad: <b className="text-white">{v.pitchToImpactM === null ? "-" : `${v.pitchToImpactM.toFixed(2)} m`}</b></div>
            <div>Pad to stumps: <b className="text-white">{v.impactToStumpsM === null ? "-" : `${v.impactToStumpsM.toFixed(2)} m`}</b></div>
            <div>Margin: <b className="text-white">{v.stumpMarginMm === null ? "-" : `${v.stumpMarginMm.toFixed(0)} mm`}</b></div>
          </div>
          {v.extreme && <p className="rounded bg-amber-300/10 p-2 text-xs text-amber-200">Extreme case: the ball pitched less than 0.4 m from the pad, so there is very little flight to project from. Broadcast systems treat these as low confidence too.</p>}
        </div>
      </div>
    </section>
  );
}
