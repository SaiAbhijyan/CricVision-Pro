/**
 * Match simulator vs real cricket. Runs the simulator for a powerplay chase and compares outcome rates with IPL ball-by-ball
 * data (data/ipl-phase-rates.json). Fails when the simulator leaves realistic bands, so a physics or rules change cannot quietly
 * turn the simulator back into a boundary machine. Usage: npx tsx scripts/sim-calibration.ts [seeds]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { simulateSession } from "../lib/sim/match-sim";
import type { SessionConfig } from "../lib/types";

const ref = JSON.parse(readFileSync(join(__dirname, "..", "data", "ipl-phase-rates.json"), "utf8")).phases;
const base: SessionConfig = { mode: "Full Match Duel (1v1)", handedness: "RHB", bowlerStyle: "Right Arm Pace", bowlerArm: "R", bowlingAngle: "Over the Wicket", boundaryRadius: 65, outfield: "Medium", surface: "Astro-Turf", format: "Powerplay Chase", batterWaist: 1, batterShoulder: 1.45, batterHead: 1.75, audioOffsetMs: 0 };
const seeds = Number(process.argv[2] ?? 8);
const c: Record<string, number> = { faced: 0, deliveries: 0, legal: 0, dot: 0, r1: 0, r2: 0, r4: 0, r6: 0, wkt: 0, wide: 0, nb: 0, runs: 0 };
for (let seed = 1; seed <= seeds; seed++) {
  for (const b of simulateSession({ cfg: base, balls: 48, seed: seed * 7919, batterSkill: 0.6 }).balls) {
    const o = b.record.outcome; c.deliveries++; if (o.legal) c.legal++;
    if (o.extra === "wide") { c.wide++; c.runs += o.runs + o.extraRuns; continue; }
    if (o.extra === "noball") c.nb++;
    c.faced++; const k = o.boundary ? `r${o.boundary}` : `r${o.extra ? 0 : o.runs}`; if (k in c) c[k]++;
    if (o.runs + o.extraRuns === 0 && !o.wicket) c.dot++;
    if (o.wicket) c.wkt++;
    c.runs += o.runs + o.extraRuns;
  }
}
const pf = (k: string) => (100 * c[k]) / c.faced;
const sim: Record<string, number> = { runRatePerOver: (6 * c.runs) / c.legal, dotPct: pf("dot"), onePct: pf("r1"), fourPct: pf("r4"), sixPct: pf("r6"), wicketPct: pf("wkt"), widePct: (100 * c.wide) / c.deliveries, noballPct: (100 * c.nb) / c.deliveries };
// bands: wide enough for sampling noise at 8 seeds, tight enough to catch a regression to the pre-calibration simulator
const bands: Record<string, [number, number]> = { runRatePerOver: [6, 10.5], dotPct: [35, 56], onePct: [16, 36], fourPct: [10, 26], sixPct: [1.5, 8], wicketPct: [1.2, 6.5], widePct: [1.5, 6.5], noballPct: [0, 2.2] };
let bad = 0;
console.log(`Powerplay, pace, batter skill 0.6, ${c.deliveries} deliveries vs IPL powerplay (${ref.powerplay.deliveries})`);
console.log("metric".padEnd(16), "sim".padStart(7), "IPL".padStart(7), "  band");
for (const [k, [lo, hi]] of Object.entries(bands)) {
  const v = sim[k], okk = v >= lo && v <= hi; if (!okk) bad++;
  console.log(k.padEnd(16), v.toFixed(2).padStart(7), String(ref.powerplay[k]).padStart(7), `  ${lo}-${hi}${okk ? "" : "  OUT OF BAND"}`);
}
console.log(bad ? `sim calibration: ${bad} metric(s) out of band` : "sim calibration: all metrics in band");
process.exit(bad ? 1 : 0);
