import type { CameraModel, Pt, Vec3, PitchSurface } from "@/lib/types";
import { project, pixelToGround } from "./homography";
import { nelderMead } from "./optim";
import { simulate, type BallState } from "./ballistics";
import { PITCH_LENGTH } from "./constants";

export interface TrackObs { t: number; px: Pt }   // t in seconds relative to first observation

export interface FitResult {
  release: Vec3;
  velocity: Vec3;
  speedMs: number;
  rmsPx: number;
  samples: { t: number; p: Vec3 }[];
}

/**
 * Recover the 3D flight from a single-camera 2D ball track by fitting the aerodynamic
 * projectile model (gravity + drag + Magnus-free) to the pixel observations.
 * Unknowns: initial 3D position (x,y,z) and velocity (vx,vy,vz) at the first observation.
 */
export function fitFlightTo2D(cam: CameraModel, obs: TrackObs[], surface: PitchSurface): FitResult | null {
  if (obs.length < 5) return null;
  const first = obs[0], last = obs[obs.length - 1];
  const dur = Math.max(1e-3, last.t - first.t);
  const g0 = pixelToGround(cam, first.px);
  const g1 = pixelToGround(cam, last.px);
  // heuristic initial guess: ground-projected chord with a nominal height
  const z0 = 1.8;
  const vy0 = (g1.y - g0.y) / dur;
  const x0 = [g0.x, g0.y, z0, (g1.x - g0.x) / dur, Math.sign(vy0 || 1) * Math.max(8, Math.abs(vy0)), -1];

  const sample = (x: number[], times: number[]): Vec3[] => {
    const st: BallState = { p: { x: x[0], y: x[1], z: x[2] }, v: { x: x[3], y: x[4], z: x[5] }, w: { x: 0, y: 0, z: 0 } };
    const r = simulate(st, { surface, dt: 0.004, tMax: times[times.length - 1] + 0.02, maxBounces: 3 });
    const out: Vec3[] = [];
    let k = 0;
    for (const t of times) {
      while (k < r.samples.length - 1 && r.samples[k + 1].t <= t) k++;
      const a = r.samples[k], b = r.samples[Math.min(k + 1, r.samples.length - 1)];
      const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      out.push({ x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, z: a.p.z + (b.p.z - a.p.z) * f });
    }
    return out;
  };
  const times = obs.map((o) => o.t - first.t);
  const cost = (x: number[]) => {
    if (x[2] < 0.05 || x[2] > 3.5) return 1e9;
    const pts = sample(x, times);
    let e = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = project(cam, pts[i]);
      if (!p) return 1e9;
      e += (p.x - obs[i].px.x) ** 2 + (p.y - obs[i].px.y) ** 2;
    }
    return e / pts.length;
  };
  let best = nelderMead(cost, x0, [0.3, 0.5, 0.3, 0.8, 2, 0.8], { maxIter: 500, tol: 1e-6 });
  // restart once from the best point (simplex collapse mitigation)
  best = nelderMead(cost, best.x, [0.1, 0.2, 0.1, 0.3, 0.8, 0.3], { maxIter: 400, tol: 1e-8 });
  const x = best.x;
  const pts = sample(x, times);
  return {
    release: { x: x[0], y: x[1], z: x[2] },
    velocity: { x: x[3], y: x[4], z: x[5] },
    speedMs: Math.hypot(x[3], x[4], x[5]),
    rmsPx: Math.sqrt(best.fx),
    samples: pts.map((p, i) => ({ t: times[i], p })),
  };
}

export const STUMP_PLANE_Y = PITCH_LENGTH;
