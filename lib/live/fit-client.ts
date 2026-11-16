import type { CameraModel, PitchSurface } from "@/lib/types";
import type { FitResult, TrackObs } from "@/lib/physics/trackfit";
import { fitFlightTo2D } from "@/lib/physics/trackfit";

let worker: Worker | null = null;
let seq = 0;

/** Run the 3-D flight fit off the main thread (it takes seconds); falls back to an inline fit if Workers are unavailable. */
export function fitInWorker(cam: CameraModel, obs: TrackObs[], surface: PitchSurface, timeoutMs = 60000): Promise<FitResult | null> {
  if (typeof Worker === "undefined") return Promise.resolve(fitFlightTo2D(cam, obs, surface));
  try { worker ??= new Worker(new URL("./fit.worker.ts", import.meta.url), { type: "module" }); }
  catch { return Promise.resolve(fitFlightTo2D(cam, obs, surface)); }
  const w = worker, id = ++seq;
  return new Promise((resolve) => {
    const done = (v: FitResult | null) => { w.removeEventListener("message", on); clearTimeout(timer); resolve(v); };
    const on = (e: MessageEvent<{ id: number; fit: FitResult | null }>) => { if (e.data.id === id) done(e.data.fit); };
    // a timed-out worker is still busy with this fit and every later fit would queue behind it: replace it
    const timer = setTimeout(() => { if (worker === w) { w.terminate(); worker = null; } done(null); }, timeoutMs);
    w.addEventListener("message", on);
    w.postMessage({ id, cam, obs, surface });
  });
}
