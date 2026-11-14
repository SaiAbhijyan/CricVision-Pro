import type { OutfieldSpeed, PitchSurface } from "@/lib/types";

export const G = 9.81;
export const AIR_RHO = 1.2;               // kg/m^3
export const BALL_MASS = 0.156;           // kg
export const BALL_DIAMETER = 0.0715;      // m
export const BALL_RADIUS = BALL_DIAMETER / 2;
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
export const CD = 0.45;                   // drag coefficient (spec)
/** Solid-sphere moment of inertia factor (2/5 m r^2) */
export const INERTIA_K = 0.4;

export const PITCH_LENGTH = 20.12;        // stump to stump
export const PITCH_WIDTH = 3.05;
export const STUMP_WIDTH = 0.2286;
export const STUMP_HALF = STUMP_WIDTH / 2;
export const STUMP_HEIGHT = 0.711;
export const POPPING_CREASE = 1.22;       // from stumps
export const RETURN_CREASE_HALF = 1.32;   // from middle stump
/** Wide guideline half-width from middle stump (competition-specific; adjust to your playing conditions). */
export const WIDE_HALF = 0.89;

export const BOWLER_CREASE_Y = POPPING_CREASE;
export const BATTER_CREASE_Y = PITCH_LENGTH - POPPING_CREASE;
export const BATTER_STUMPS_Y = PITCH_LENGTH;

export interface SurfaceSpec {
  cor: number;      // vertical coefficient of restitution
  mu: number;       // ball/surface friction coefficient
  seamKick: number; // m/s lateral kick at 30 m/s normal speed (random-seam surrogate)
  label: string;
}

export const SURFACES: Record<PitchSurface, SurfaceSpec> = {
  "Green/Seam": { cor: 0.82, mu: 0.35, seamKick: 1.4, label: "Green/Seam" },
  "Dry/Dusty": { cor: 0.72, mu: 0.58, seamKick: 0.4, label: "Dry/Dusty" },
  "Astro-Turf": { cor: 0.85, mu: 0.25, seamKick: 0.0, label: "Astro-Turf" },
};

/** Outfield rolling deceleration (m/s^2) and bounce COR */
export const OUTFIELD: Record<OutfieldSpeed, { decel: number; cor: number }> = {
  Slow: { decel: 1.9, cor: 0.50 },
  Medium: { decel: 1.2, cor: 0.55 },
  Lightning: { decel: 0.7, cor: 0.60 },
};

export const KPH = 3.6;
export const toKph = (ms: number) => ms * KPH;
export const toMs = (kph: number) => kph / KPH;
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const wrap180 = (d: number) => {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
};
export const wrap360 = (d: number) => ((d % 360) + 360) % 360;
