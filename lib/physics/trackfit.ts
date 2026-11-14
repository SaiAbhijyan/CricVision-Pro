import type { CameraModel, Pt, Vec3, PitchSurface } from "@/lib/types";
import { project, unprojectAtHeight } from "./homography";
import { nelderMead } from "./optim";
import { simulate, type BallState } from "./ballistics";
import { PITCH_LENGTH } from "./constants";

const RPM = (2 * Math.PI) / 60;

export interface TrackObs { t: number; px: Pt }   // t in seconds relative to first observation

export interface FitResult {
  release: Vec3;
  velocity: Vec3;
  speedMs: number;
  rmsPx: number;
  samples: { t: number; p: Vec3 }[];
  /** fitted seam-swing / drift acceleration (m/s^2, +X) and spin about the travel axis (rpm); small values mean "not observable" */
  swingAccel: number;
  turnRpm: number;
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
  const sample = (x: number[], times: number[]): Vec3[] => {
    const st: BallState = { p: { x: x[0], y: x[1], z: x[2] }, v: { x: x[3], y: x[4], z: x[5] }, w: { x: 0, y: x[7] * RPM, z: 0 } };
    const r = simulate(st, { surface, swingAccel: x[6], dt: 0.005, tMax: times[times.length - 1] + 0.02, maxBounces: 3 });
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
    if (x[2] < 0.05 || x[2] > 3.5 || Math.abs(x[6]) > 7 || Math.abs(x[7]) > 3000) return 1e9;
    const pts = sample(x, times);
    let e = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = project(cam, pts[i]);
      if (!p) return 1e9;
      e += (p.x - obs[i].px.x) ** 2 + (p.y - obs[i].px.y) ** 2;
    }
    // weak ridge prior: a straight, non-spinning ball unless the pixels clearly say otherwise (stops noise becoming "swing")
    return e / pts.length + 0.4 * (x[6] / 3) ** 2 + 0.4 * (x[7] / 1500) ** 2;
  };
  // Multi-start: a single guess is not enough for a one-camera fit because the height of the first/last observation is
  // unknown. Back-project both ends at several plausible heights, take gravity into account, and refine the best few.
  // The flight is a boundary-value problem: back-project the first and last observation at heights (zA, zB), then the
  // launch velocity follows from gravity over the observed duration. So search a coarse (zA, zB) grid, keep the best
  // cells, and only then let the full 8-parameter simplex polish them.
  const cells: { x: number[]; c: number }[] = [];
  const lin = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  for (const zA of lin(0.5, 2.9, 13)) for (const zB of lin(0.05, 2.3, 13)) {
    const p0 = unprojectAtHeight(cam, first.px, zA), p1 = unprojectAtHeight(cam, last.px, zB);
    if (!p0 || !p1) continue;
    const x = [p0.x, p0.y, zA, (p1.x - p0.x) / dur, (p1.y - p0.y) / dur, (zB - zA) / dur + 0.5 * 9.81 * dur, 0, 0];
    cells.push({ x, c: cost(x) });
  }
  if (!cells.length) return null;
  cells.sort((u, v) => u.c - v.c);
  const free6 = (x: number[]) => nelderMead((q) => cost([...q, 0, 0]), x.slice(0, 6), [0.2, 0.4, 0.2, 0.5, 1.2, 0.5], { maxIter: 500, tol: 1e-7 }).x;
  let best: { x: number[]; fx: number } | null = null;
  for (const st of cells.slice(0, 10)) {
    const g = [...free6(st.x), 0, 0];
    let r = nelderMead(cost, g, [0.1, 0.2, 0.1, 0.3, 0.8, 0.3, 1, 400], { maxIter: 600, tol: 1e-8 });
    r = nelderMead(cost, r.x, [0.04, 0.08, 0.04, 0.12, 0.3, 0.12, 0.4, 150], { maxIter: 400, tol: 1e-9 });
    if (!best || r.fx < best.fx) best = r;
    if (best.fx < 1.8) break;
  }
  if (!best) return null;
  const x = best.x;
  const pts = sample(x, times);
  return {
    release: { x: x[0], y: x[1], z: x[2] },
    velocity: { x: x[3], y: x[4], z: x[5] },
    speedMs: Math.hypot(x[3], x[4], x[5]),
    rmsPx: Math.sqrt(best.fx),
    samples: pts.map((p, i) => ({ t: times[i], p })),
    swingAccel: x[6],
    turnRpm: x[7],
  };
}

export const STUMP_PLANE_Y = PITCH_LENGTH;
