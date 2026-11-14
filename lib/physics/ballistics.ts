import type { BallMovement, DeliveryFlight, FlightSample, Handedness, PitchSurface, Vec3, OutfieldSpeed } from "@/lib/types";
import {
  AIR_RHO, BALL_AREA, BALL_MASS, BALL_RADIUS, CD, G, INERTIA_K, OUTFIELD, PITCH_LENGTH, PITCH_WIDTH,
  SURFACES, deg, toKph,
} from "./constants";
import { nelderMead } from "./optim";

const RPM = (2 * Math.PI) / 60;

export interface BallState { p: Vec3; v: Vec3; w: Vec3 }

export interface FlightOptions {
  surface: PitchSurface;
  outfield?: OutfieldSpeed;
  /** constant lateral (+X) aerodynamic "seam swing" acceleration in m/s^2, pre-bounce only */
  swingAccel?: number;
  /** -1..1 random-seam surrogate: lateral kick at pitching on seaming surfaces */
  seamDir?: number;
  dt?: number;
  tMax?: number;
  /** stop when y crosses this plane (moving toward +Y) */
  stopAtY?: number;
  /** allow only the first bounce to be simulated (delivery) */
  maxBounces?: number;
}

const k_drag = (0.5 * AIR_RHO * CD * BALL_AREA) / BALL_MASS;

/** acceleration of the ball (gravity + quadratic drag + Magnus lift/drift + optional seam swing) */
function accel(s: BallState, swing: number, preBounce: boolean): Vec3 {
  const { v, w } = s;
  const sp = Math.hypot(v.x, v.y, v.z);
  let ax = -k_drag * sp * v.x;
  let ay = -k_drag * sp * v.y;
  let az = -G - k_drag * sp * v.z;
  const wm = Math.hypot(w.x, w.y, w.z);
  if (sp > 1 && wm > 1e-6) {
    // Magnus: F ~ 0.5 rho A Cl v^2 * unit(w x v)
    const cx = w.y * v.z - w.z * v.y;
    const cy = w.z * v.x - w.x * v.z;
    const cz = w.x * v.y - w.y * v.x;
    const cn = Math.hypot(cx, cy, cz);
    if (cn > 1e-9) {
      const S = (BALL_RADIUS * wm) / sp;
      const Cl = Math.min(0.35, 1.6 * S);
      const mag = (0.5 * AIR_RHO * BALL_AREA * Cl * sp * sp) / BALL_MASS;
      ax += (mag * cx) / cn; ay += (mag * cy) / cn; az += (mag * cz) / cn;
    }
  }
  if (preBounce && swing) ax += swing;
  return { x: ax, y: ay, z: az };
}

function rk4(s: BallState, dt: number, swing: number, pre: boolean): BallState {
  const f = (st: BallState) => ({ v: st.v, a: accel(st, swing, pre) });
  const add = (st: BallState, k: { v: Vec3; a: Vec3 }, h: number): BallState => ({
    p: { x: st.p.x + k.v.x * h, y: st.p.y + k.v.y * h, z: st.p.z + k.v.z * h },
    v: { x: st.v.x + k.a.x * h, y: st.v.y + k.a.y * h, z: st.v.z + k.a.z * h },
    w: st.w,
  });
  const k1 = f(s);
  const k2 = f(add(s, k1, dt / 2));
  const k3 = f(add(s, k2, dt / 2));
  const k4 = f(add(s, k3, dt));
  return {
    p: {
      x: s.p.x + (dt / 6) * (k1.v.x + 2 * k2.v.x + 2 * k3.v.x + k4.v.x),
      y: s.p.y + (dt / 6) * (k1.v.y + 2 * k2.v.y + 2 * k3.v.y + k4.v.y),
      z: s.p.z + (dt / 6) * (k1.v.z + 2 * k2.v.z + 2 * k3.v.z + k4.v.z),
    },
    v: {
      x: s.v.x + (dt / 6) * (k1.a.x + 2 * k2.a.x + 2 * k3.a.x + k4.a.x),
      y: s.v.y + (dt / 6) * (k1.a.y + 2 * k2.a.y + 2 * k3.a.y + k4.a.y),
      z: s.v.z + (dt / 6) * (k1.a.z + 2 * k2.a.z + 2 * k3.a.z + k4.a.z),
    },
    w: s.w,
  };
}

/** Rigid-sphere impact with Coulomb friction. Returns the post-impact state (position clamped to the surface). */
export function bounceImpact(s: BallState, cor: number, mu: number, seamKick = 0, seamDir = 0): BallState {
  const R = BALL_RADIUS;
  const vzIn = s.v.z;
  const vzOut = -cor * vzIn;
  const ux = s.v.x - R * s.w.y;
  const uy = s.v.y + R * s.w.x;
  const um = Math.hypot(ux, uy);
  let dvx = 0, dvy = 0;
  if (um > 1e-9) {
    const slide = mu * (1 + cor) * Math.abs(vzIn);
    const stick = um / (1 + 1 / INERTIA_K);
    const j = Math.min(slide, stick);
    dvx = (-ux / um) * j;
    dvy = (-uy / um) * j;
  }
  const dwx = dvy / (INERTIA_K * R);
  const dwy = -dvx / (INERTIA_K * R);
  const kick = seamKick * seamDir * Math.min(1.5, Math.abs(vzIn) / 30);
  return {
    p: { x: s.p.x, y: s.p.y, z: R },
    v: { x: s.v.x + dvx + kick, y: s.v.y + dvy, z: vzOut },
    w: { x: s.w.x + dwx, y: s.w.y + dwy, z: s.w.z },
  };
}

const onPitchStrip = (p: Vec3) => p.y >= -0.5 && p.y <= PITCH_LENGTH + 1.5 && Math.abs(p.x) <= PITCH_WIDTH / 2 + 0.3;

export interface SimResult {
  samples: FlightSample[];
  bounce: { t: number; p: Vec3; vIn: Vec3; vOut: Vec3 } | null;
  atPlane: { t: number; p: Vec3; v: Vec3 } | null;
  final: BallState;
  tEnd: number;
}

export function simulate(init: BallState, o: FlightOptions): SimResult {
  const dt = o.dt ?? 0.001;
  const tMax = o.tMax ?? 3;
  const maxB = o.maxBounces ?? 1;
  const surf = SURFACES[o.surface];
  let s: BallState = { p: { ...init.p }, v: { ...init.v }, w: { ...init.w } };
  let t = 0;
  let bounces = 0;
  const samples: FlightSample[] = [{ t, p: { ...s.p }, v: { ...s.v }, bounced: false }];
  let bounce: SimResult["bounce"] = null;
  let atPlane: SimResult["atPlane"] = null;
  let n = 0;
  while (t < tMax) {
    const prev = s;
    s = rk4(s, dt, o.swingAccel ?? 0, bounces === 0);
    t += dt;
    n++;
    // plane crossing
    if (o.stopAtY !== undefined && prev.p.y < o.stopAtY && s.p.y >= o.stopAtY) {
      const f = (o.stopAtY - prev.p.y) / (s.p.y - prev.p.y || 1e-12);
      const lerpv = (a: number, b: number) => a + (b - a) * f;
      const p = { x: lerpv(prev.p.x, s.p.x), y: o.stopAtY, z: lerpv(prev.p.z, s.p.z) };
      const v = { x: lerpv(prev.v.x, s.v.x), y: lerpv(prev.v.y, s.v.y), z: lerpv(prev.v.z, s.v.z) };
      atPlane = { t: t - dt + f * dt, p, v };
      samples.push({ t: atPlane.t, p, v, bounced: bounces > 0 });
      break;
    }
    if (s.p.z <= BALL_RADIUS && s.v.z < 0) {
      // linear interpolation back to the contact instant
      const f = (prev.p.z - BALL_RADIUS) / ((prev.p.z - s.p.z) || 1e-12);
      const lerpv = (a: number, b: number) => a + (b - a) * f;
      const contact: BallState = {
        p: { x: lerpv(prev.p.x, s.p.x), y: lerpv(prev.p.y, s.p.y), z: BALL_RADIUS },
        v: { x: lerpv(prev.v.x, s.v.x), y: lerpv(prev.v.y, s.v.y), z: lerpv(prev.v.z, s.v.z) },
        w: s.w,
      };
      const tc = t - dt + f * dt;
      let out: BallState;
      if (onPitchStrip(contact.p)) {
        out = bounceImpact(contact, surf.cor, surf.mu, surf.seamKick, o.seamDir ?? 0);
      } else {
        out = bounceImpact(contact, OUTFIELD[o.outfield ?? "Medium"].cor, 0.45);
      }
      if (bounces === 0) bounce = { t: tc, p: { ...contact.p }, vIn: { ...contact.v }, vOut: { ...out.v } };
      bounces++;
      samples.push({ t: tc, p: { ...contact.p }, v: { ...contact.v }, bounced: false });
      s = out;
      if (bounces > maxB) break;
    }
    if (n % 10 === 0) samples.push({ t, p: { ...s.p }, v: { ...s.v }, bounced: bounces > 0 });
  }
  return { samples, bounce, atPlane, final: s, tEnd: t };
}

/* ------------------------------------------------------------------ */
/* Deliveries                                                          */
/* ------------------------------------------------------------------ */

export interface DeliverySpec {
  release: Vec3;               // m
  speedMs: number;
  bounce: { x: number; y: number }; // target pitching point
  backRpm: number;             // + backspin (floats), - topspin (dips)
  turnRpm: number;             // spin about travel axis: + turns toward +X after pitching
  driftRpm: number;            // side spin: + curves toward +X in the air
  swingAccel: number;          // m/s^2 (+X)
  seamDir: number;             // -1..1
  surface: PitchSurface;
}

export function spinVector(d: Pick<DeliverySpec, "backRpm" | "turnRpm" | "driftRpm">): Vec3 {
  return { x: d.backRpm * RPM, y: d.turnRpm * RPM, z: -d.driftRpm * RPM };
}

function launchState(d: DeliverySpec, az: number, el: number): BallState {
  const c = Math.cos(el);
  return {
    p: { ...d.release },
    v: { x: d.speedMs * c * Math.sin(az), y: d.speedMs * c * Math.cos(az), z: d.speedMs * Math.sin(el) },
    w: spinVector(d),
  };
}

/** Find launch azimuth/elevation so that the first bounce lands on d.bounce. */
export function solveLaunch(d: DeliverySpec): { az: number; el: number; err: number } {
  const target = d.bounce;
  const cost = ([az, el]: number[]) => {
    const r = simulate(launchState(d, az, el), {
      surface: d.surface, swingAccel: d.swingAccel, seamDir: d.seamDir, dt: 0.004, tMax: 1.6, maxBounces: 1,
    });
    if (!r.bounce) return 1e3 + Math.abs(el) * 10;
    return (r.bounce.p.x - target.x) ** 2 + (r.bounce.p.y - target.y) ** 2;
  };
  const az0 = Math.atan2(target.x - d.release.x, target.y - d.release.y);
  const dist = Math.hypot(target.x - d.release.x, target.y - d.release.y);
  const el0 = -Math.atan2(d.release.z - 0.04, dist) * 0.9;
  const sol = nelderMead(cost, [az0, el0], [0.01, 0.02], { maxIter: 160, tol: 1e-10 });
  return { az: sol.x[0], el: sol.x[1], err: Math.sqrt(sol.fx) };
}

export function simulateDelivery(d: DeliverySpec, hand: Handedness, launch?: { az: number; el: number }): DeliveryFlight {
  const L = launch ?? solveLaunch(d);
  return flightFromState(launchState(d, L.az, L.el), { surface: d.surface, swingAccel: d.swingAccel, seamDir: d.seamDir }, d.release, d.speedMs, hand);
}

/** Integrate a delivery from an arbitrary initial state (used by the synthetic simulator and by the live 2D-track fit). */
export function flightFromState(init: BallState, o: { surface: PitchSurface; swingAccel: number; seamDir: number }, release: Vec3, speedMs: number, hand: Handedness): DeliveryFlight {
  const r = simulate(init, { surface: o.surface, swingAccel: o.swingAccel, seamDir: o.seamDir, dt: 0.001, tMax: 2, stopAtY: PITCH_LENGTH });
  const offSign = hand === "RHB" ? 1 : -1;
  let swingCm = 0;
  let postTurn = 0;
  let bounceSpeed = 0;
  if (r.bounce) {
    const a = release, b = r.bounce.p;
    for (const s of r.samples) {
      if (s.t > r.bounce.t) break;
      const f = (s.p.y - a.y) / (b.y - a.y || 1e-9);
      const chordX = a.x + f * (b.x - a.x);
      swingCm = Math.max(swingCm, Math.abs(s.p.x - chordX) * 100);
    }
    const pre = deg(Math.atan2(r.bounce.vIn.x, r.bounce.vIn.y));
    const post = deg(Math.atan2(r.bounce.vOut.x, r.bounce.vOut.y));
    postTurn = (post - pre) * offSign;
    bounceSpeed = toKph(Math.hypot(r.bounce.vIn.x, r.bounce.vIn.y, r.bounce.vIn.z));
  }
  const movement = measureMovement(init, o, r, offSign) ?? undefined;
  return {
    samples: r.samples,
    bounce: r.bounce,
    movement,
    atStumps: r.atPlane,
    releaseSpeedKph: toKph(speedMs),
    bounceSpeedKph: bounceSpeed,
    swingCm,
    postBounceTurnDeg: postTurn,
    bounceHeightAtStumpsCm: r.atPlane ? r.atPlane.p.z * 100 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Movement versus a normal delivery                                    */
/* ------------------------------------------------------------------ */

type Path = { x: number; y: number; z: number }[];
const thin = (samples: FlightSample[], upToT: number, n = 40): Path => {
  const s = samples.filter((q) => q.t <= upToT);
  if (s.length <= n) return s.map((q) => ({ x: q.p.x, y: q.p.y, z: q.p.z }));
  return Array.from({ length: n }, (_, i) => { const q = s[Math.round((i * (s.length - 1)) / (n - 1))]; return { x: q.p.x, y: q.p.y, z: q.p.z }; });
};
/** lateral x of a path at a given y (first crossing), linear interpolation */
const xAtY = (samples: FlightSample[], y: number): number | null => {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].p, b = samples[i].p;
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  return null;
};

/**
 * Fly the SAME release (position, velocity) with the spin removed and no seam swing: that is the "normal delivery".
 * Anything the real ball does beyond it is swing (in the air), turn (off the pitch) or float/dip (spin changing length).
 */
function measureMovement(
  init: BallState, o: { surface: PitchSurface; swingAccel: number; seamDir: number },
  actual: ReturnType<typeof simulate>, offSign: number,
): BallMovement | null {
  if (!actual.bounce || !actual.atPlane) return null;
  const base = simulate({ p: { ...init.p }, v: { ...init.v }, w: { x: 0, y: 0, z: 0 } }, {
    surface: o.surface, swingAccel: 0, seamDir: 0, dt: 0.001, tMax: 2, stopAtY: PITCH_LENGTH,
  });
  if (!base.bounce || !base.atPlane) return null;
  const yb = actual.bounce.p.y;
  const xb0 = xAtY(base.samples, yb) ?? base.bounce.p.x;
  const air = (actual.bounce.p.x - xb0) * offSign * 100;
  let airMax = 0;
  for (const s of actual.samples) {
    if (s.t > actual.bounce.t) break;
    const xb = xAtY(base.samples, s.p.y);
    if (xb !== null) { const d = (s.p.x - xb) * offSign * 100; if (Math.abs(d) > Math.abs(airMax)) airMax = d; }
  }
  const total = (actual.atPlane.p.x - base.atPlane.p.x) * offSign * 100;
  const turn = total - air;
  const pre = Math.atan2(actual.bounce.vIn.x, actual.bounce.vIn.y);
  const post = Math.atan2(actual.bounce.vOut.x, actual.bounce.vOut.y);
  const preB = Math.atan2(base.bounce.vIn.x, base.bounce.vIn.y);
  const postB = Math.atan2(base.bounce.vOut.x, base.bounce.vOut.y);
  const turnDeg = (deg(post - pre) - deg(postB - preB)) * offSign;
  return {
    airSwingCm: air, airSwingMaxCm: airMax, turnCm: turn, totalMoveCm: total,
    pitchShiftM: base.bounce.p.y - actual.bounce.p.y,
    turnDeg,
    spinRpm: Math.hypot(init.w.x, init.w.y, init.w.z) / RPM,
    spinAxisTiltDeg: Math.abs(deg(Math.atan2(init.w.z, init.w.x))) > 90 ? 180 - Math.abs(deg(Math.atan2(init.w.z, init.w.x))) : Math.abs(deg(Math.atan2(init.w.z, init.w.x))),
    swingType: Math.abs(airMax) < 1 ? "Straight" : airMax > 0 ? "Away" : "In",
    turnType: Math.abs(turn) < 1.5 ? "Straight" : turn > 0 ? "Away" : "In",
    actual: thin(actual.samples, actual.tEnd),
    baseline: thin(base.samples, base.tEnd),
  };
}

/* ------------------------------------------------------------------ */
/* Shots                                                               */
/* ------------------------------------------------------------------ */

export interface ShotSpec {
  from: Vec3;
  exitSpeedMs: number;
  azimuthDeg: number;    // clockwise from straight (toward -Y)
  elevationDeg: number;
  backspinRpm: number;   // + backspin, - topspin
  outfield: OutfieldSpeed;
  boundaryRadius: number;
}

export interface ShotResult {
  samples: FlightSample[];       // incl. rolling phase
  firstBounce: { t: number; p: Vec3 } | null;
  /** boundary rope crossing */
  crossing: { t: number; p: Vec3; onFull: boolean } | null;
  rest: { t: number; p: Vec3 } | null;
}

export const GROUND_CENTRE = { x: 0, y: PITCH_LENGTH / 2 };

export function shotDirection(azimuthDeg: number): { x: number; y: number } {
  const a = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

export function simulateShot(sp: ShotSpec): ShotResult {
  const dir = shotDirection(sp.azimuthDeg);
  const el = (sp.elevationDeg * Math.PI) / 180;
  const c = Math.cos(el);
  // Backspin about the horizontal axis perpendicular to travel: w = wMag * (d.y, -d.x, 0)  =>  w x v points +Z (lift)
  const wMag = sp.backspinRpm * RPM;
  const w: Vec3 = { x: dir.y * wMag, y: -dir.x * wMag, z: 0 };
  const v: Vec3 = { x: sp.exitSpeedMs * c * dir.x, y: sp.exitSpeedMs * c * dir.y, z: sp.exitSpeedMs * Math.sin(el) };
  let s: BallState = { p: { ...sp.from }, v, w };
  const of = OUTFIELD[sp.outfield];
  const dt = 0.002;
  let t = 0;
  const samples: FlightSample[] = [{ t, p: { ...s.p }, v: { ...s.v }, bounced: false }];
  let firstBounce: ShotResult["firstBounce"] = null;
  let crossing: ShotResult["crossing"] = null;
  let rest: ShotResult["rest"] = null;
  let bounced = false;
  let n = 0;
  const radial = (p: Vec3) => Math.hypot(p.x - GROUND_CENTRE.x, p.y - GROUND_CENTRE.y);
  while (t < 14) {
    const prev = s;
    s = rk4(s, dt, 0, false);
    t += dt; n++;
    if (!crossing && radial(s.p) >= sp.boundaryRadius) {
      crossing = { t, p: { ...s.p }, onFull: !bounced };
      samples.push({ t, p: { ...s.p }, v: { ...s.v }, bounced });
      break;
    }
    if (s.p.z <= BALL_RADIUS && s.v.z < 0) {
      const f = (prev.p.z - BALL_RADIUS) / ((prev.p.z - s.p.z) || 1e-12);
      const contact: BallState = {
        p: { x: prev.p.x + (s.p.x - prev.p.x) * f, y: prev.p.y + (s.p.y - prev.p.y) * f, z: BALL_RADIUS },
        v: { x: prev.v.x + (s.v.x - prev.v.x) * f, y: prev.v.y + (s.v.y - prev.v.y) * f, z: prev.v.z + (s.v.z - prev.v.z) * f },
        w: s.w,
      };
      const onPitch = onPitchStrip(contact.p) && contact.p.y > 3 && contact.p.y < PITCH_LENGTH;
      const surfCor = onPitch ? 0.7 : of.cor;
      s = bounceImpact(contact, surfCor, 0.45);
      if (!bounced) firstBounce = { t: t - dt + f * dt, p: { ...contact.p } };
      bounced = true;
      samples.push({ t: t - dt + f * dt, p: { ...contact.p }, v: { ...contact.v }, bounced: false });
      if (Math.abs(s.v.z) < 0.9) { s.v.z = 0; s.p.z = BALL_RADIUS; break; }
    }
    if (n % 10 === 0) samples.push({ t, p: { ...s.p }, v: { ...s.v }, bounced });
  }
  // rolling phase (constant deceleration along the ground)
  if (!crossing) {
    let p = { ...s.p, z: BALL_RADIUS };
    let vh = { x: s.v.x, y: s.v.y };
    const sp0 = Math.hypot(vh.x, vh.y);
    if (sp0 > 1e-3) {
      const ux = vh.x / sp0, uy = vh.y / sp0;
      const step = 0.02;
      let speed = sp0;
      while (speed > 0.05 && t < 40) {
        const adv = speed * step - 0.5 * of.decel * step * step;
        p = { x: p.x + ux * Math.max(0, adv), y: p.y + uy * Math.max(0, adv), z: BALL_RADIUS };
        speed = Math.max(0, speed - of.decel * step);
        t += step;
        samples.push({ t, p: { ...p }, v: { x: ux * speed, y: uy * speed, z: 0 }, bounced: true });
        if (radial(p) >= sp.boundaryRadius) {
          crossing = { t, p: { ...p }, onFull: false };
          break;
        }
      }
      if (!crossing) rest = { t, p: { ...p } };
    } else {
      rest = { t, p };
    }
  }
  return { samples, firstBounce, crossing, rest };
}
