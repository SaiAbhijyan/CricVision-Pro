/**
 * Swing-only analysis: a batter's swings found from the body alone, for footage where no ball is tracked (shadow batting,
 * throw-downs seen from the side, a ball too small to see). The contact moment is taken as the fastest point of the hands'
 * downswing, so timing against a ball is not available; weight transfer, bat speed, swing plane and the rest are the same
 * numbers the ball-based path produces.
 */
import type { BallRecord, Handedness, SessionConfig } from "@/lib/types";
import { extractBatting } from "@/lib/cv/biomech";
import type { Skeleton } from "@/lib/cv/skeleton";

const mid = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

export const SWING_MIN_HANDS_MS = 3.5;   // hands (midpoint of the wrists) must exceed this speed, m/s
export const SWING_GAP_S = 1.5;          // two swings closer than this are one

/** Times (clip seconds) of the fastest hand speed in each swing. */
export function detectSwings(frames: Skeleton[]): number[] {
  if (frames.length < 10) return [];
  const sp: number[] = frames.map(() => 0);
  for (let i = 1; i < frames.length - 1; i++) {
    const a = mid(frames[i - 1].j.lWr, frames[i - 1].j.rWr), b = mid(frames[i + 1].j.lWr, frames[i + 1].j.rWr), dt = frames[i + 1].t - frames[i - 1].t;
    if (dt > 0) sp[i] = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt;
  }
  const sm = sp.map((_, i) => (sp[Math.max(0, i - 1)] + sp[i] + sp[Math.min(sp.length - 1, i + 1)]) / 3);
  const out: number[] = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] < SWING_MIN_HANDS_MS || sm[i] < sm[i - 1] || sm[i] < sm[i + 1]) continue;
    const t = frames[i].t, last = out[out.length - 1];
    if (last !== undefined && t - last < SWING_GAP_S) { const j = frames.findIndex((f) => f.t === last); if (sm[i] > sm[j]) out[out.length - 1] = t; continue; }
    out.push(t);
  }
  return out;
}

/** One BallRecord per swing, with the batting numbers and no ball fields. Swings the body tracker could not follow are skipped. */
export function swingRecords(frames: Skeleton[], hand: Handedness, cfg: SessionConfig, startIndex: number, startedAt: number): { record: BallRecord; impactT: number }[] {
  const out: { record: BallRecord; impactT: number }[] = [];
  for (const t of detectSwings(frames)) {
    const win = frames.filter((f) => f.t >= t - 2.5 && f.t <= t + 0.4);
    const bx = extractBatting(win, { hand, impactT: t });
    if (!bx || !bx.biomech.swingDetected) continue;
    const i = startIndex + out.length;
    out.push({ impactT: t, record: {
      id: `b${i + 1}`, index: i + 1, over: 0, ballInOver: 1, timeMs: startedAt,
      length: null, line: null, bounceYFromBatter: null, bounceX: null, speedKph: null, bounceSpeedKph: null, swingCm: null, turnDeg: null, movement: null,
      bounceHeightCm: null, stumpArrival: null, bowling: null, batting: bx.biomech, timing: null, shot: null, ballistics: null,
      outcome: { runs: 0, extraRuns: 0, extra: null, legal: false, wicket: null, boundary: null, freeHitNext: false, notes: ["Swing analysed without a ball: no timing, shot or runs."] },
      flags: ["Swing only (no ball tracked)"], clipId: null, synthetic: false,
      quality: { trackPoints: 0, fitRmsPx: 0, contact: "none", bowlerPoseFrames: 0, batterPoseFrames: win.length, confidence: win.length >= 20 ? 0.6 : 0.4, warnings: ["Contact time was taken from the fastest part of the swing, so timing against the ball is not measured."] },
    } });
  }
  void cfg;
  return out;
}

/** For the live camera: swings in the rolling pose window that are newer than `afterT` and finished (0.5 s of follow-through seen by `nowT`). */
export function finishedSwings(frames: Skeleton[], hand: Handedness, cfg: SessionConfig, afterT: number, nowT: number, startIndex: number, startedAt: number) {
  const out: { record: BallRecord; impactT: number }[] = [];
  for (const t of detectSwings(frames)) {
    if (t <= afterT + SWING_GAP_S || nowT - t < 0.5) continue;
    const r = swingRecords(frames.filter((f) => f.t >= t - 2.5 && f.t <= t + 0.4), hand, cfg, startIndex + out.length, startedAt);
    if (r[0]) out.push({ ...r[0], impactT: t });
  }
  return out;
}
