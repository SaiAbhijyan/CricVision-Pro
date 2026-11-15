import type { BallRecord } from "@/lib/types";

/** Says plainly how far to trust the numbers. Camera and uploaded-clip sessions are single-camera estimates. */
export default function QualityBanner({ mode, balls }: { mode: "sim" | "live" | "upload"; balls: BallRecord[] }) {
  if (mode === "sim") return null;
  const q = balls.filter((b) => b.quality);
  const swingOnly = q.length > 0 && q.every((b) => b.flags.includes("Swing only (no ball tracked)"));
  const weak = q.filter((b) => (b.quality?.confidence ?? 1) < 0.7);
  return (
    <section className="card space-y-2 border-amber-300/30 text-sm" aria-label="How far to trust these numbers">
      <div className="flex items-center gap-2"><span className="rounded bg-amber-300/20 px-2 py-0.5 text-xs font-semibold text-amber-200">ESTIMATE</span><b>Measured from one {mode === "upload" ? "uploaded clip" : "phone camera"}, not a radar gun.</b></div>
      <p className="text-white/65">
        Speed, line and length come from fitting the ball&apos;s flight to what the camera saw. On test footage with known physics those were close (within a few km/h and about 0.3 m), but they have not yet been compared with a radar gun on real deliveries.
        Swing, turn and spin are rougher estimates and are not validated. Body angles depend on how clearly the pose tracker saw the player.
      </p>
      {swingOnly && <p className="text-white/65">No ball was tracked, so these are swing measurements only: bat speed, weight transfer, head movement and swing plane. Timing against the ball, shot and runs are not available.</p>}
      {!swingOnly && weak.length > 0 && <p className="text-amber-200">{weak.length} of {q.length} deliveries had a weak track. Their numbers are marked below.</p>}
      {q.length > 0 && (
        <details>
          <summary className="cursor-pointer text-white/70">Per-delivery confidence</summary>
          <ul className="mt-2 space-y-1.5">
            {q.map((b) => { const x = b.quality!; return (
              <li key={b.index}><b>{b.flags.includes("Swing only (no ball tracked)") ? "Swing" : "Ball"} {b.index}</b>: confidence {(x.confidence * 100).toFixed(0)}%{x.speedSigmaKph !== undefined ? `, speed ±${x.speedSigmaKph.toFixed(0)} km/h` : ""}, {x.trackPoints ? `${x.trackPoints} ball positions,` : "swing only,"} contact {x.contact === "none" ? "not found" : x.contact === "audio" ? "from sound" : "marked by you"}.
                {x.warnings.length > 0 && <ul className="ml-4 list-disc text-white/55">{x.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              </li>); })}
          </ul>
        </details>
      )}
    </section>
  );
}
