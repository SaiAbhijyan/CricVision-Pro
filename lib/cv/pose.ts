import type { CameraModel, Pt } from "@/lib/types";
import { pixelToGround, pitchCorridor, pointInPolygon } from "@/lib/physics/homography";
import { liftToWorld, type Skeleton } from "./skeleton";
import { PITCH_LENGTH } from "@/lib/physics/constants";

export interface PoseOptions {
  /** .task model URL; copy it into /public/models for fully-offline use (see README). */
  modelUrl?: string;
  wasmBase?: string;
  delegate?: "GPU" | "CPU";
  numPoses?: number;
}

const DEFAULTS = {
  modelUrl: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  wasmBase: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm",
};

export interface PosePair { bowler: Skeleton | null; batter: Skeleton | null; people: number }

/** MediaPipe Pose Landmarker (33 landmarks) with pitch-corridor filtering of umpires / fielders and bowler/batter assignment. */
export class PoseTracker {
  private lm: import("@mediapipe/tasks-vision").PoseLandmarker | null = null;
  private corridor: Pt[] = [];
  private lastTs = -1;

  constructor(private cam: CameraModel, private opts: PoseOptions = {}) { this.corridor = pitchCorridor(cam, 1.2, 4); }
  setCamera(cam: CameraModel) { this.cam = cam; this.corridor = pitchCorridor(cam, 1.2, 4); }

  /** Prefer the self-hosted runtime and model (npm run vendor:models); fall back to the public CDN unless self-host-only. */
  private async resolveAssets(): Promise<{ wasm: string; model: string }> {
    const has = async (u: string) => { try { return (await fetch(u, { method: "HEAD" })).ok; } catch { return false; } };
    const wasm = this.opts.wasmBase ?? ((await has("/mediapipe/wasm/vision_wasm_internal.wasm")) ? "/mediapipe/wasm" : null);
    const model = this.opts.modelUrl ?? ((await has("/models/pose_landmarker_lite.task")) ? "/models/pose_landmarker_lite.task" : null);
    if ((!wasm || !model) && process.env.NEXT_PUBLIC_SELF_HOST_ONLY === "1") throw new Error("Self-host-only mode: run `npm run vendor:models` to install the pose model locally.");
    return { wasm: wasm ?? DEFAULTS.wasmBase, model: model ?? DEFAULTS.modelUrl };
  }

  async init() {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const assets = await this.resolveAssets();
    const fileset = await FilesetResolver.forVisionTasks(assets.wasm);
    this.lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: assets.model, delegate: this.opts.delegate ?? "GPU" },
      runningMode: "VIDEO", numPoses: this.opts.numPoses ?? 4,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  }

  /** `tSec` is the frame timestamp in seconds; the returned skeletons carry the same `t`. */
  detect(video: HTMLVideoElement | ImageBitmap | HTMLCanvasElement, tSec: number): PosePair {
    if (!this.lm) return { bowler: null, batter: null, people: 0 };
    const ms = Math.max(this.lastTs + 1, Math.round(tSec * 1000));   // MediaPipe requires strictly increasing timestamps
    this.lastTs = ms;
    const res = this.lm.detectForVideo(video as HTMLVideoElement, ms);
    const W = this.cam.imageWidth, H = this.cam.imageHeight;
    const cands: { sk: Skeleton; y: number }[] = [];
    for (let i = 0; i < res.landmarks.length; i++) {
      const lmk = res.landmarks[i], wld = res.worldLandmarks[i];
      const hip: Pt = { x: ((lmk[23].x + lmk[24].x) / 2) * W, y: ((lmk[23].y + lmk[24].y) / 2) * H };
      const foot: Pt = { x: ((lmk[27].x + lmk[28].x) / 2) * W, y: ((lmk[27].y + lmk[28].y) / 2) * H };
      if (!pointInPolygon(foot, this.corridor) && !pointInPolygon(hip, this.corridor)) continue;   // umpire, slip cordon, spectators
      const g = pixelToGround(this.cam, foot);
      if (g.y < -4 || g.y > PITCH_LENGTH + 4) continue;
      const sk = liftToWorld(this.cam, lmk, wld, tSec);
      if (sk) cands.push({ sk, y: g.y });
    }
    cands.sort((a, b) => a.y - b.y);
    // bowler = person nearest the bowler's end, batter = nearest the batter's end (needs ≥2 people to disambiguate)
    if (cands.length >= 2) return { bowler: cands[0].sk, batter: cands[cands.length - 1].sk, people: cands.length };
    if (cands.length === 1) {
      const c = cands[0];
      return c.y < PITCH_LENGTH / 2 ? { bowler: c.sk, batter: null, people: 1 } : { bowler: null, batter: c.sk, people: 1 };
    }
    return { bowler: null, batter: null, people: 0 };
  }

  close() { this.lm?.close(); this.lm = null; }
}
