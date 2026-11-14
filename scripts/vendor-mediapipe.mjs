// Copies the MediaPipe WASM runtime out of node_modules and (best effort) downloads the pose model, so the app can run
// with NO third-party requests. Run automatically after `npm install`; safe to re-run. Failure to download the model is
// not fatal: the app falls back to the public CDN unless NEXT_PUBLIC_SELF_HOST_ONLY=1.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/mediapipe/wasm");
if (existsSync(wasmSrc)) { mkdirSync(wasmDst, { recursive: true }); cpSync(wasmSrc, wasmDst, { recursive: true }); console.log("vendor: copied MediaPipe WASM ->", wasmDst); }
else console.log("vendor: @mediapipe/tasks-vision not installed yet, skipping WASM copy");

const modelDst = join(root, "public/models/pose_landmarker_lite.task");
if (!existsSync(modelDst)) {
  const url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(modelDst), { recursive: true });
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log("vendor: downloaded pose model ->", modelDst);
  } catch (e) { console.log("vendor: could not download the pose model (", String(e), ") - download it manually to public/models/pose_landmarker_lite.task"); }
}
