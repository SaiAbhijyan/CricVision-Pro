/**
 * Swing-only analysis: a batter's swings found from the body alone, for footage where no ball is tracked (shadow batting,
 * throw-downs seen from the side, a ball too small to see). The contact moment is taken as the fastest point of the hands'
 * downswing, so timing against a ball is not available; weight transfer, bat speed, swing plane and the rest are the same
 * numbers the ball-based path produces.
 */
import type { BallRecord, Handedness, SessionConfig } from "@/lib/types";
import { extractBatting } from "@/lib/cv/biomech";
import type { JointName, Skeleton } from "@/lib/cv/skeleton";

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

/** Why a detected movement is not reported as a swing (null = it passes). Physical limits and tracking consistency: on real
 *  broadcast footage the hands-speed peak also fires on walking, celebrations, other players and camera moves. */
export function swingRejectReason(win: Skeleton[], t: number, b: { strideCm: number; headDriftCm: number; backliftDeg: number; downswingMs: number }): string | null {
  const core = win.filter((f) => f.t >= t - 1.0 && f.t <= t + 0.3);
  // coverage relative to the pose rate actually used (every frame, every second frame, a 60 or 240 fps clip...)
  const gaps = win.slice(1).map((f, i) => f.t - win[i].t).filter((d) => d > 0).sort((a, b) => a - b);
  const dt = gaps.length ? gaps[gaps.length >> 1] : 1 / 30, expected = 1.3 / dt;
  if (core.length < Math.max(8, 0.6 * expected)) return "the batter was not tracked for long enough around the swing";
  for (let i = 1; i < core.length; i++) {
    const a = core[i - 1].j, c = core[i].j, dt = Math.max(1e-3, core[i].t - core[i - 1].t);
    const hip = Math.hypot((a.lHip.x + a.rHip.x - c.lHip.x - c.rHip.x) / 2, (a.lHip.y + a.rHip.y - c.lHip.y - c.rHip.y) / 2);
    if (hip / dt > 9) return "the tracked body jumped (another person, or a camera cut)";
  }
  const hz = core.map((f) => f.j.nose.z).sort((x, y) => x - y), med = hz[hz.length >> 1];
  if (hz[0] < med - 0.45 || hz[hz.length - 1] > med + 0.35) return "the body's size changed (zoom or a different person)";
  // a batter is nearly still before the shot; a bowler running in or a fielder chasing is not
  const pre = core.filter((f) => f.t <= t - 0.3), hipV: number[] = [];
  for (let i = 1; i < pre.length; i++) { const a = pre[i - 1].j, c = pre[i].j; hipV.push(Math.hypot((a.lHip.x + a.rHip.x - c.lHip.x - c.rHip.x) / 2, (a.lHip.y + a.rHip.y - c.lHip.y - c.rHip.y) / 2) / Math.max(1e-3, pre[i].t - pre[i - 1].t)); }
  hipV.sort((x, y) => x - y);
  if (hipV.length >= 4 && hipV[hipV.length >> 1] > 2.2) return "the person was running, not batting";
  if (b.strideCm > 160) return "the stride is longer than a batter can take";
  if (Math.abs(b.headDriftCm) > 60) return "the head moved further than in any swing";
  if (b.downswingMs < 100) return "no backlift was found before the fast movement";
  return null;
}

/** One BallRecord per swing, with the batting numbers and no ball fields. Movements that fail the checks above are dropped
 *  (their count and reasons go to `rejected`). */
export function swingRecords(frames: Skeleton[], hand: Handedness, cfg: SessionConfig, startIndex: number, startedAt: number, rejected?: string[]): { record: BallRecord; impactT: number }[] {
  const out: { record: BallRecord; impactT: number }[] = [];
  for (const t of detectSwings(frames)) {
    const win = frames.filter((f) => f.t >= t - 2.5 && f.t <= t + 0.4);
    const bx = extractBatting(win, { hand, impactT: t });
    if (!bx || !bx.biomech.swingDetected) continue;
    const why = swingRejectReason(win, t, bx.biomech);
    if (why) { rejected?.push(why); continue; }
    const warnings = ["Contact time was taken from the fastest part of the swing, so timing against the ball is not measured."];
    // a downswing this long is a slow-motion replay (or no real swing): speeds and times from it would be wrong
    if (bx.biomech.downswingMs > 700) {
      bx.biomech.unmeasured = [...new Set([...(bx.biomech.unmeasured ?? []), "batSpeed" as const])];
      warnings.push(`The downswing took ${Math.round(bx.biomech.downswingMs)} ms, which looks like slow motion: bat speed and timing are not measured. Set the slow-motion factor to measure them.`);
    }
    const i = startIndex + out.length;
    out.push({ impactT: t, record: {
      id: `b${i + 1}`, index: i + 1, over: 0, ballInOver: 1, timeMs: startedAt,
      length: null, line: null, bounceYFromBatter: null, bounceX: null, speedKph: null, bounceSpeedKph: null, swingCm: null, turnDeg: null, movement: null,
      bounceHeightCm: null, stumpArrival: null, bowling: null, batting: bx.biomech, timing: null, shot: null, ballistics: null,
      outcome: { runs: 0, extraRuns: 0, extra: null, legal: false, wicket: null, boundary: null, freeHitNext: false, notes: ["Swing analysed without a ball: no timing, shot or runs."] },
      flags: ["Swing only (no ball tracked)"], clipId: null, synthetic: false,
      quality: { trackPoints: 0, fitRmsPx: 0, contact: "none", bowlerPoseFrames: 0, batterPoseFrames: win.length, confidence: win.length >= 20 ? 0.6 : 0.4, warnings },
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

const swapLR = (j: Skeleton["j"]): Skeleton["j"] => {
  const o = { ...j } as Skeleton["j"];
  for (const k of Object.keys(j) as JointName[]) if (k !== "nose") { const m = (k[0] === "l" ? "r" : "l") + k.slice(1) as JointName; o[m] = j[k]; }
  return o;
};

/**
 * MediaPipe sometimes swaps left and right for a whole shot (side-on and from-behind views), which flips the pitch direction
 * and every directional number. In the stance a batter looks at the bowler, so the nose sits bowler-side of the hips: if, over
 * the stance frames, the labelled front foot is consistently on the other side from the nose, the labels are swapped.
 * Measured on a real highlight reel: the two cues agreed in 10/10 or 0/10 stance frames per shot, never in between.
 * When the nose offset is too small to tell (under 3 cm), labels are left alone.
 */
export function fixLeftRight(frames: Skeleton[], hand: Handedness, stanceBefore?: number): { frames: Skeleton[]; swapped: boolean } {
  const st = stanceBefore !== undefined ? frames.filter((f) => f.t <= stanceBefore) : [];
  const use = st.length >= 3 ? st : frames.slice(0, Math.max(3, Math.floor(frames.length / 3)));
  const front = hand === "RHB" ? "lAnk" : "rAnk", back = hand === "RHB" ? "rAnk" : "lAnk";
  let agree = 0, disagree = 0;
  for (const f of use) {
    const j = f.j, hx = (j.lHip.x + j.rHip.x) / 2, hy = (j.lHip.y + j.rHip.y) / 2;
    const nx = j.nose.x - hx, ny = j.nose.y - hy;
    if (Math.hypot(nx, ny) < 0.03) continue;
    const d = nx * (j[front].x - j[back].x) + ny * (j[front].y - j[back].y);
    if (d > 0) agree++; else if (d < 0) disagree++;
  }
  const n = agree + disagree;
  if (n >= 3 && disagree >= 0.75 * n) return { frames: frames.map((f) => ({ t: f.t, j: swapLR(f.j) })), swapped: true };
  return { frames, swapped: false };
}

/**
 * Turn camera-axis skeletons into the pitch frame without a calibration: a side-on batter's hip and shoulder lines point down
 * the pitch in the stance, so the median of that direction becomes "toward the bowler" (-Y) and the batter is placed at the
 * popping crease. Every swing number is then the same whatever angle the camera filmed from.
 */
export function alignToStance(frames: Skeleton[], hand: Handedness, creaseY: number, stanceBefore?: number): Skeleton[] {
  if (!frames.length) return frames;
  // In a side-on stance the hip and shoulder lines point at the bowler (the feet are often a little open), so use those, from
  // frames before the backlift when there are any.
  const L = hand === "RHB", st = stanceBefore !== undefined ? frames.filter((f) => f.t <= stanceBefore) : [];
  const use = st.length >= 3 ? st : frames;
  const angs: number[] = [];
  const pairs: [JointName, JointName][] = L ? [["lHip", "rHip"], ["lSh", "rSh"]] : [["rHip", "lHip"], ["rSh", "lSh"]];
  for (const f of use) for (const [a, b] of pairs) angs.push(Math.atan2(f.j[a].y - f.j[b].y, f.j[a].x - f.j[b].x));
  angs.sort((a, b) => a - b);
  // circular median: pick the angle with the smallest summed distance to the rest
  let ang = angs[Math.floor(angs.length / 2)], bestCost = Infinity;
  for (const a of angs.filter((_, i) => i % Math.max(1, Math.floor(angs.length / 40)) === 0)) {
    let c = 0; for (const b of angs) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); c += Math.abs(d); }
    if (c < bestCost) { bestCost = c; ang = a; }
  }
  const rot = -Math.PI / 2 - ang, cs = Math.cos(rot), sn = Math.sin(rot);
  const h0 = frames.map((f) => ({ x: (f.j.lHip.x + f.j.rHip.x) / 2, y: (f.j.lHip.y + f.j.rHip.y) / 2 }));
  const cx = h0.reduce((a, p) => a + p.x, 0) / h0.length, cy = h0.reduce((a, p) => a + p.y, 0) / h0.length;
  const pcx = cx * cs - cy * sn, pcy = cx * sn + cy * cs;
  return frames.map((f) => {
    const j = {} as Skeleton["j"];
    for (const k of Object.keys(f.j) as (keyof Skeleton["j"])[]) { const p = f.j[k]; j[k] = { x: p.x * cs - p.y * sn - pcx, y: p.x * sn + p.y * cs - pcy + creaseY + 0.15, z: p.z }; }
    return { t: f.t, j };
  });
}

/** Angle (0-90°) between the stance's pitch direction (hips and shoulders) and the camera's line of sight (+Y in camera-axis
 *  skeletons). 90 = side-on (stride across the picture), 0 = front-on or from behind (stride along the depth). */
export function stanceAxisToCameraDeg(frames: Skeleton[], hand: Handedness, stanceBefore?: number): number {
  const st = stanceBefore !== undefined ? frames.filter((f) => f.t <= stanceBefore) : [];
  const use = st.length >= 3 ? st : frames;
  const L = hand === "RHB", angs: number[] = [];
  for (const f of use) for (const [a, b] of (L ? [["lHip", "rHip"], ["lSh", "rSh"]] : [["rHip", "lHip"], ["rSh", "lSh"]]) as [JointName, JointName][]) {
    const dx = f.j[a].x - f.j[b].x, dy = f.j[a].y - f.j[b].y;
    if (Math.hypot(dx, dy) > 0.05) angs.push((Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI);   // 0 = along +Y (depth)
  }
  angs.sort((a, b) => a - b);
  return angs.length ? angs[angs.length >> 1] : 90;
}
