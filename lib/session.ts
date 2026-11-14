import type { CameraModel, ClipMeta, FieldPlayer, SessionConfig } from "@/lib/types";
import { buildCameraModel } from "@/lib/physics/homography";
import { virtualCalibration } from "@/lib/sim/virtual-camera";
import { applyDisguiseScores, type SimBall } from "@/lib/sim/match-sim";
import { buildSimClip, clipReason } from "@/lib/sim/clips";
import type { ScoreState } from "@/lib/rules/scoreboard";
import { putClip, putSession, type StoredSession } from "@/lib/storage/idb";

export const virtualCamera = (w = 1280, h = 720): CameraModel => buildCameraModel(virtualCalibration(w, h))!;

/** Finish a simulated session: disguise post-pass, 4 s slow-motion clips for flagged balls, persist everything to IndexedDB. */
export async function finalizeSim(opts: { id: string; cfg: SessionConfig; balls: SimBall[]; score: ScoreState; field: FieldPlayer[]; startedAt: number }): Promise<StoredSession> {
  const { id, cfg, balls, score, field, startedAt } = opts;
  applyDisguiseScores(balls.map((b) => b.record));
  const cam = virtualCamera();
  const clips: ClipMeta[] = [];
  for (const b of balls) {
    const why = clipReason(b);
    if (!why) continue;
    const clip = buildSimClip(b, cam, id, why);
    b.record.clipId = clip.id;
    clips.push(clip);
  }
  const sess: StoredSession = {
    id, startedAt, endedAt: Date.now(), config: cfg, balls: balls.map((b) => b.record), runs: score.runs, wickets: score.wickets, legalBalls: score.legalBalls,
    mode: "sim", calibration: virtualCalibration(), field,
  };
  await putSession(sess);
  for (const c of clips) await putClip(c);
  return sess;
}
