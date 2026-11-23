import type { FieldPlayer, Handedness, OutfieldSpeed, Vec3 } from "@/lib/types";
import { PITCH_LENGTH } from "@/lib/physics/constants";
import { GROUND_CENTRE, shotDirection, type ShotResult } from "@/lib/physics/ballistics";

/* ----------------------------- fielder kinematics ----------------------------- */

export const FIELDER = {
  vmax: 7.4,          // m/s sprint
  accel: 6.0,         // m/s^2
  react: 0.22,        // s
  catchReach: 1.15,   // m horizontal catching reach (stretch / dive)
  catchMaxZ: 2.4,     // m
  catchMinZ: 0.12,    // m
  pickupReach: 1.5,   // m: ground-ball reach including a dive
  gather: 0.65,       // s to gather, set and release (on the move, not standing)
  throwSpeed: 25,     // m/s flat throw to the stumps
  keeperTake: 0.5,    // s for the keeper/bowler to take it and break the stumps (direct hits are the exception)
  circle30: 27.43,    // 30 yards
};

/** Time for a fielder to cover distance d (starting at rest, after reaction time) */
export function reachTime(d: number): number {
  if (d <= 0) return FIELDER.react;
  const da = (FIELDER.vmax * FIELDER.vmax) / (2 * FIELDER.accel);
  const run = d <= da ? Math.sqrt((2 * d) / FIELDER.accel) : FIELDER.vmax / FIELDER.accel + (d - da) / FIELDER.vmax;
  return FIELDER.react + run;
}

/** Cumulative time for the batters to complete n runs from a standing start (crease-to-crease 17.68 m). */
export const runTime = (n: number) => 3.0 + 2.9 * (n - 1);   // a quick single ~3.0 s from contact; each extra run ~2.9 s incl. the turn

/* ----------------------------------- presets ----------------------------------- */

const BATTER = { x: 0, y: PITCH_LENGTH };

/** (angle clockwise from straight, distance from the batter) – RHB orientation, mirrored for LHB */
type Polar = [string, number, number];

export const PRESET_NAMES = ["Powerplay", "Test Off-Side Ring", "Death Overs", "Spin Attack"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

const PRESETS: Record<PresetName, Polar[]> = {
  Powerplay: [
    ["Slip", 155, 8], ["Point", 95, 20], ["Cover", 55, 24], ["Mid-off", 22, 24], ["Mid-on", -22, 24],
    ["Midwicket", -62, 24], ["Square leg", -95, 20], ["Third man", 140, 63], ["Fine leg", -148, 63],
  ],
  "Test Off-Side Ring": [
    ["Slip 1", 158, 8], ["Slip 2", 152, 10], ["Slip 3", 146, 12], ["Gully", 124, 14], ["Point", 95, 20],
    ["Cover", 60, 24], ["Mid-off", 25, 26], ["Mid-on", -25, 26], ["Square leg", -90, 22],
  ],
  "Death Overs": [
    ["Long-off", 22, 66], ["Long-on", -22, 66], ["Deep midwicket", -62, 62], ["Deep square", -95, 60],
    ["Deep third", 140, 63], ["Cover", 55, 22], ["Mid-off", 22, 24], ["Square leg", -95, 18], ["Fine leg", -150, 25],
  ],
  "Spin Attack": [
    ["Slip", 158, 8], ["Silly point", 82, 4], ["Short leg", -80, 4], ["Cover", 55, 24], ["Mid-off", 22, 24],
    ["Mid-on", -22, 24], ["Midwicket", -62, 26], ["Deep square", -95, 55], ["Long-on", -22, 62],
  ],
};

export function buildPreset(name: PresetName, hand: Handedness, boundary: number): FieldPlayer[] {
  const mirror = hand === "LHB" ? -1 : 1;
  const out: FieldPlayer[] = PRESETS[name].map(([label, ang, dist], i) => {
    const d = shotDirection(ang * mirror);
    // keep the deep fielders just inside the rope
    let r = dist;
    let x = BATTER.x + d.x * r, y = BATTER.y + d.y * r;
    const rad = Math.hypot(x - GROUND_CENTRE.x, y - GROUND_CENTRE.y);
    if (rad > boundary - 2) {
      const k = (boundary - 2) / rad;
      x = GROUND_CENTRE.x + (x - GROUND_CENTRE.x) * k; y = GROUND_CENTRE.y + (y - GROUND_CENTRE.y) * k;
    }
    return { id: `F${i + 1}`, label, x, y };
  });
  return withFixed(out);
}

/** Wicket-keeper and bowler are always present but not draggable. */
export function withFixed(fielders: FieldPlayer[]): FieldPlayer[] {
  const movable = fielders.filter((f) => f.id !== "WK" && f.id !== "BWL");
  return [
    ...movable,
    { id: "WK", label: "Keeper", x: 0, y: PITCH_LENGTH + 13, keeper: true },
    { id: "BWL", label: "Bowler", x: 0.6, y: 4 },
  ];
}

export function outsideCircleCount(fielders: FieldPlayer[]): number {
  return fielders.filter((f) => f.id !== "WK" && f.id !== "BWL" &&
    Math.hypot(f.x - GROUND_CENTRE.x, f.y - GROUND_CENTRE.y) > FIELDER.circle30).length;
}

/* ---------------------------------- resolution ---------------------------------- */

export interface FieldResolution {
  kind: "caught" | "boundary" | "fielded";
  runs: number;
  boundary: 4 | 6 | null;
  fielderId?: string;
  fielderLabel?: string;
  pickupT?: number;
  note: string;
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** `rng`: when given, catches can be dropped (success falls from ~95% for a sitter to ~55% at full stretch); without it every
 *  catch in reach is taken, which keeps rule tests deterministic. */
export function resolveFielding(shot: ShotResult, fielders: FieldPlayer[], opts: { allowCatch: boolean; outfield: OutfieldSpeed; rng?: () => number }): FieldResolution {
  const fs = fielders;
  // 1) Catches: ball elevation 0.12–2.4 m before its first bounce, within a fielder's reach
  if (opts.allowCatch) {
    for (const s of shot.samples) {
      if (shot.firstBounce && s.t >= shot.firstBounce.t) break;
      if (s.t < 0.15) continue;
      if (s.p.z < FIELDER.catchMinZ || s.p.z > FIELDER.catchMaxZ) continue;
      for (const f of fs) {
        const d = dist2(f, s.p);
        // the bowler is off balance in the follow-through: shorter reach and a later start than a set fielder
        const bowler = /bowler/i.test(f.id) || /bowler/i.test(f.label);
        const gap = Math.max(0, d - (bowler ? 0.6 : FIELDER.catchReach)), need = reachTime(gap) + (bowler ? 0.2 : 0);
        if (need <= s.t) {
          const slack = s.t - need, pTake = Math.min(0.9, 0.45 + 0.8 * slack);   // professional catching efficiency ~75-90%
          if (opts.rng && opts.rng() > pTake) {
            const r = fieldedResult(s.t + 0.5, s.p, f);   // put down: the fumble costs half a second
            return { ...r, note: `Dropped by ${f.label} (${Math.round(pTake * 100)}% chance); ${r.note}` };
          }
          return { kind: "caught", runs: 0, boundary: null, fielderId: f.id, fielderLabel: f.label, pickupT: s.t,
            note: `Caught by ${f.label} at ${s.p.z.toFixed(1)} m (${d.toFixed(1)} m away)` };
        }
      }
    }
  }
  // 2) Ground interception
  const afterBounce = shot.samples.filter((s) => (shot.firstBounce ? s.t >= shot.firstBounce.t : true) && s.p.z <= 0.9);
  const limitT = shot.crossing ? shot.crossing.t : Infinity;
  for (const s of afterBounce) {
    if (s.t > limitT) break;
    for (const f of fs) {
      const gap = Math.max(0, dist2(f, s.p) - FIELDER.pickupReach);
      if (reachTime(gap) <= s.t) return fieldedResult(s.t, s.p, f);
    }
  }
  // 3) Boundary
  if (shot.crossing) {
    const six = shot.crossing.onFull;
    return { kind: "boundary", runs: six ? 6 : 4, boundary: six ? 6 : 4, pickupT: shot.crossing.t,
      note: six ? "Maximum – cleared the rope" : "Four – beat the field to the rope" };
  }
  // 4) ball came to rest un-intercepted: nearest fielder collects it
  const rest = shot.rest ?? { t: shot.samples[shot.samples.length - 1]?.t ?? 0, p: shot.samples[shot.samples.length - 1]?.p ?? { x: 0, y: 0, z: 0 } };
  let best: { f: FieldPlayer; t: number } | null = null;
  for (const f of fs) {
    const t = Math.max(rest.t, reachTime(Math.max(0, dist2(f, rest.p) - FIELDER.pickupReach)));
    if (!best || t < best.t) best = { f, t };
  }
  return best ? fieldedResult(best.t, rest.p, best.f) : { kind: "fielded", runs: 0, boundary: null, note: "Dead ball" };
}

function fieldedResult(t: number, p: Vec3, f: FieldPlayer): FieldResolution {
  // throw to the nearer end
  const toBowlerEnd = dist2(p, { x: 0, y: 0 });
  const toBatterEnd = dist2(p, { x: 0, y: PITCH_LENGTH });
  const throwD = Math.min(toBowlerEnd, toBatterEnd);
  const T = t + FIELDER.gather + throwD / FIELDER.throwSpeed + FIELDER.keeperTake;
  let runs = 0;
  while (runs < 3 && runTime(runs + 1) < T) runs++;
  return { kind: "fielded", runs, boundary: null, fielderId: f.id, fielderLabel: f.label, pickupT: t,
    note: `${f.label} fields at ${throwD.toFixed(0)} m from the stumps; ${runs} run${runs === 1 ? "" : "s"}` };
}
