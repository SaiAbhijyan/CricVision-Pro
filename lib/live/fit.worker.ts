/// <reference lib="webworker" />
import { fitFlightTo2D, type TrackObs } from "@/lib/physics/trackfit";
import type { CameraModel, PitchSurface } from "@/lib/types";

self.onmessage = (e: MessageEvent<{ id: number; cam: CameraModel; obs: TrackObs[]; surface: PitchSurface }>) => {
  const { id, cam, obs, surface } = e.data;
  try { (self as unknown as Worker).postMessage({ id, fit: fitFlightTo2D(cam, obs, surface) }); }
  catch { (self as unknown as Worker).postMessage({ id, fit: null }); }
};
export {};
