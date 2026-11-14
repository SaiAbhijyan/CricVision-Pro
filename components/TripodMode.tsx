"use client";
import { useEffect } from "react";

/** Thermal saver: black dim overlay + wake lock while the phone sits on a tripod; the session loop also drops to a lower processing rate. */
export default function TripodMode({ active, hud, onExit }: { active: boolean; hud: string; onExit: () => void }) {
  useEffect(() => {
    if (!active) return;
    let lock: WakeLockSentinel | null = null;
    (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } }).wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => { void lock?.release(); };
  }, [active]);
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/95" onDoubleClick={onExit}>
      <div className="text-center text-white/40">
        <div className="mb-2 text-xs uppercase tracking-widest">Tripod mode · recording · double-tap to exit</div>
        <div className="text-2xl font-bold text-white/60">{hud}</div>
      </div>
    </div>
  );
}
