import { project } from "@/lib/physics/homography";
import { comOverlay } from "@/lib/cv/com";
import type { Handedness } from "@/lib/types";
import type { CameraModel, ClipMeta, ClipOverlayFrame } from "@/lib/types";
import { JOINTS, projectSkeleton, type Skeleton } from "@/lib/cv/skeleton";
import type { FrameRing } from "@/lib/cv/frame-ring";
import type { TrackPt } from "./pipeline";

const nearestSk = (fr: Skeleton[], t: number, tol = 0.06): Skeleton | null => {
  let best: Skeleton | null = null, bd = tol;
  for (const s of fr) { const d = Math.abs(s.t - t); if (d < bd) { bd = d; best = s; } }
  return best;
};

/** Builds an annotated highlight clip (JPEG frames + skeleton/tracer overlays) from the live circular frame buffer. */
export async function buildLiveClip(o: {
  id: string; sessionId: string; ballIndex: number; reason: string; cam: CameraModel; ring: FrameRing<ImageBitmap>;
  t0: number; t1: number; bowler: Skeleton[]; batter: Skeleton[]; track: TrackPt[]; hand?: Handedness;
}): Promise<{ meta: ClipMeta; frames: Blob[] } | null> {
  const fr = o.ring.range(o.t0, o.t1);
  if (fr.length < 4) return null;
  const W = fr[0].item.width, H = fr[0].item.height, k = W / o.cam.imageWidth;
  const frames: Blob[] = [], overlays: ClipOverlayFrame[] = [], tracer: { x: number; y: number }[] = [];
  const oc = new OffscreenCanvas(W, H), g = oc.getContext("2d")!;
  for (const f of fr) {
    g.drawImage(f.item, 0, 0);
    frames.push(await oc.convertToBlob({ type: "image/jpeg", quality: 0.7 }));
    const lm: { x: number; y: number }[] = [];
    for (const arr of [o.bowler, o.batter]) {
      const s = nearestSk(arr, f.t);
      if (!s) { for (let n = 0; n < JOINTS.length; n++) lm.push({ x: -1, y: -1 }); continue; }
      const pr = projectSkeleton(o.cam, s);
      for (const j of JOINTS) lm.push(pr[j] ? { x: pr[j]!.x * k, y: pr[j]!.y * k } : { x: -1, y: -1 });
    }
    let b: { x: number; y: number } | null = null, bd = 0.05;
    for (const p of o.track) { const d = Math.abs(p.t - f.t); if (d < bd) { bd = d; b = { x: p.x * k, y: p.y * k }; } }
    if (b) tracer.push(b);
    const bs = nearestSk(o.batter, f.t), bprev = nearestSk(o.batter, f.t - 1 / 30);
    const com = bs ? comOverlay((p) => project(o.cam, p), bs, bprev && bprev !== bs ? bprev : undefined, o.hand ?? "RHB", k) : null;
    overlays.push({ t: f.t - fr[0].t, landmarks: lm, ball: b, com });
  }
  const dt = (fr[fr.length - 1].t - fr[0].t) / (fr.length - 1);
  return { meta: { id: o.id, sessionId: o.sessionId, ballIndex: o.ballIndex, reason: o.reason, createdAt: Date.now(), frameCount: fr.length, width: W, height: H, fps: dt > 0 ? 1 / dt : 30, overlays, tracer }, frames };
}
