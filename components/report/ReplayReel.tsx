"use client";
import { useState } from "react";
import type { ClipMeta } from "@/lib/types";
import ReplayCanvas from "../ReplayCanvas";

export default function ReplayReel({ clips }: { clips: ClipMeta[] }) {
  const [i, setI] = useState(0);
  if (!clips.length) return <div className="card text-sm text-white/50">No highlight clips were flagged this session.</div>;
  const c = clips[Math.min(i, clips.length - 1)];
  return (
    <div className="card no-print">
      <h3 className="mb-2 font-bold">Slow-motion highlight reel</h3>
      <div className="mb-2 flex flex-wrap gap-1">{clips.map((k, n) => <button key={k.id} className={`btn ${n === i ? "!bg-lime-glow !text-black" : ""}`} onClick={() => setI(n)}>#{k.ballIndex} {k.reason}</button>)}</div>
      <ReplayCanvas key={c.id} clip={c} />
    </div>
  );
}
