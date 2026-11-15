/**
 * Swing analysis on pose landmarks extracted from a real clip (scripts/real-pose.cjs).
 * usage: npx tsx scripts/real-swing.ts <pose.json> <metresPerPx> <refPx> <pitchDeg> <RHB|LHB> [minHandsMs]
 */
import { readFileSync } from "fs";
import { liftWeakPerspective, type Skeleton } from "../lib/cv/skeleton";
import { detectSwings, swingRecords } from "../lib/upload/swing";
import { BATTER_CREASE_Y } from "../lib/physics/constants";
const [file, mpp, ref, pitch, hand = "RHB", slow = "1"] = process.argv.slice(2);
const d = JSON.parse(readFileSync(file, "utf8")) as { w: number; h: number; frames: { t: number; lm: number[][] | null; wl: number[][] | null }[] };
const sk: Skeleton[] = [];
for (const f of d.frames) {
  if (!f.lm || !f.wl) continue;
  const s = liftWeakPerspective(f.lm.map((l) => ({ x: l[0], y: l[1] })), f.wl.map((l) => ({ x: l[0], y: l[1], z: l[2] })), f.t / +slow, { metresPerPx: +mpp, refPx: +ref, imageWidth: d.w, pitchDeg: +pitch, hipY: BATTER_CREASE_Y + 0.15 });
  if (s) sk.push(s);
}
console.log("skeletons", sk.length, "span", sk[0]?.t.toFixed(2), "-", sk[sk.length - 1]?.t.toFixed(2));
// hands speed trace
const sp: string[] = [];
for (let i = 1; i < sk.length - 1; i += 2) { const a = sk[i - 1].j, b = sk[i + 1].j, dt = sk[i + 1].t - sk[i - 1].t; const m = (j: typeof a) => ({ x: (j.lWr.x + j.rWr.x) / 2, y: (j.lWr.y + j.rWr.y) / 2, z: (j.lWr.z + j.rWr.z) / 2 }); const p = m(a), q = m(b); sp.push(`${sk[i].t.toFixed(1)}:${(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / dt).toFixed(1)}`); }
console.log("hands m/s", sp.join(" "));
const sw = detectSwings(sk); console.log("swings at", sw.map((x) => x.toFixed(2)));
const cfg: never = { mode: "Full Match Duel (1v1)", handedness: hand } as never;
for (const r of swingRecords(sk, hand as "RHB", cfg, 0, 0)) { const b = r.record.batting!; console.log(`swing @${r.impactT.toFixed(2)}s bat ${b.batSpeedKph.toFixed(0)} km/h front ${b.frontFootPct.toFixed(0)}% stride ${b.strideCm.toFixed(0)} cm drift ${b.headDriftCm.toFixed(1)} cm downswing ${b.downswingMs.toFixed(0)} ms arc ${b.swingArcCm.toFixed(0)} cm attack ${b.attackAngleDeg.toFixed(0)}° path ${b.swingPathDeg.toFixed(0)}° backlift ${b.backliftDeg.toFixed(0)}° trigger ${b.triggerMs.toFixed(0)} ms`); }
