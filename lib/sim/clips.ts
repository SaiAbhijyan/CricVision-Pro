import type { CameraModel, ClipMeta, ClipOverlayFrame, Pt } from "@/lib/types";
import { project } from "@/lib/physics/homography";
import { JOINTS, projectSkeleton, type Skeleton } from "@/lib/cv/skeleton";
import { stateAtT } from "@/lib/rules/umpire";
import type { SimBall } from "./match-sim";

/** Landmark layout in ClipOverlayFrame.landmarks: [bowler JOINTS..., batter JOINTS...] in clip pixel space. */
export const CLIP_LANDMARK_LAYOUT = { joints: JOINTS, people: ["bowler", "batter"] as const };

const nearest = (fr: Skeleton[], t: number): Skeleton | null => {
  if (!fr.length) return null;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; }
  const a = fr[Math.max(0, lo - 1)], b = fr[lo];
  return Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
};

/** 4-second annotated replay data (skeletons + Hawkeye tracer) for a simulated ball. */
export function buildSimClip(b: SimBall, cam: CameraModel, sessionId: string, reason: string, fps = 30): ClipMeta {
  const W = cam.imageWidth, H = cam.imageHeight;
  const t0 = -0.6, dur = 4;
  const overlays: ClipOverlayFrame[] = [];
  const tracer: Pt[] = [];
  const flightEnd = b.flight.samples[b.flight.samples.length - 1].t;
  const shot = b.shot;
  const ballAt = (t: number) => {
    if (t < 0) return null;
    if (b.contactT !== null && shot && t >= b.contactT) {
      const ts = t - b.contactT;
      const s = shot.samples;
      let i = 0; while (i < s.length - 1 && s[i + 1].t < ts) i++;
      return s[i].p;
    }
    if (t > flightEnd) return b.flight.samples[b.flight.samples.length - 1].p;
    return stateAtT(b.flight, t).p;
  };
  const n = Math.round(dur * fps);
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fps;
    const lm: { x: number; y: number }[] = [];
    for (const frames of [b.bowlerFrames, b.batterFrames]) {
      const s = nearest(frames, t);
      if (!s) { for (let k = 0; k < JOINTS.length; k++) lm.push({ x: -1, y: -1 }); continue; }
      const pr = projectSkeleton(cam, s);
      for (const k of JOINTS) lm.push(pr[k] ?? { x: -1, y: -1 });
    }
    const bp = ballAt(t);
    const px = bp ? project(cam, bp) : null;
    if (px) tracer.push(px);
    overlays.push({ t, landmarks: lm, ball: px });
  }
  return { id: `${sessionId}-c${b.record.index}`, sessionId, ballIndex: b.record.index, reason, createdAt: Date.now(), frameCount: n, width: W, height: H, fps, overlays, tracer };
}

export function clipReason(b: SimBall): string | null {
  const o = b.record.outcome;
  if (o.wicket) return `Wicket – ${o.wicket}`;
  if (o.boundary) return `Boundary ${o.boundary}`;
  if (o.extra === "noball") return "No-ball";
  const major = b.record.flags.find((f) => /Elbow|Counter-rotation|Collapsed|Head drift|Unstable/.test(f));
  return major ?? null;
}
