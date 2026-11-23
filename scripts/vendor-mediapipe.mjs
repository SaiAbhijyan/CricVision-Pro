// Copies the MediaPipe WASM runtime out of node_modules and installs the pose model into public/, so the app runs with NO
// third-party requests. Runs after `npm install`; safe to re-run.
//
// Model sources, in order:
//  1. Google's official model URL.
//  2. A pinned npm mirror (pose-landmarker-react-native@0.1.0 ships Google's .task files). Many networks (CI, corporate,
//     sandboxes) reach the npm registry but not Google storage. The file is accepted only if its SHA-256 matches the pin:
//     the same bytes are published independently by vision-camera-pose-landmarks-plugin, and a REA inventory shows the
//     archive holds exactly MediaPipe's two models (pose_detector.tflite, pose_landmarks_detector.tflite) and nothing
//     executable. See docs/VALIDATION.md.
// Failure is not fatal: the app falls back to the public CDN unless NEXT_PUBLIC_SELF_HOST_ONLY=1.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/mediapipe/wasm");
if (existsSync(wasmSrc)) { mkdirSync(wasmDst, { recursive: true }); cpSync(wasmSrc, wasmDst, { recursive: true }); console.log("vendor: copied MediaPipe WASM ->", wasmDst); }
else console.log("vendor: @mediapipe/tasks-vision not installed yet, skipping WASM copy");

// ONNX Runtime (MIT) for the bat model: the plain WASM build, one thread, so no cross-origin isolation is needed
const ortSrc = join(root, "node_modules/onnxruntime-web/dist"), ortDst = join(root, "public/ort");
if (existsSync(ortSrc)) {
  mkdirSync(ortDst, { recursive: true });
  for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) cpSync(join(ortSrc, f), join(ortDst, f));
  console.log("vendor: copied ONNX Runtime WASM ->", ortDst);
}
// bat model (YOLOv8n-OBB trained in this repo on an MIT cricket-bat dataset; see models/README.md), hash-checked
{
  const src = join(root, "models/bat_obb.onnx"), dst = join(root, "public/models/bat_obb.onnx");
  const want = existsSync(join(root, "models/bat_obb.onnx.sha256")) ? readFileSync(join(root, "models/bat_obb.onnx.sha256"), "utf8").trim().split(/\s+/)[0] : null;
  if (existsSync(src)) {
    const got = createHash("sha256").update(readFileSync(src)).digest("hex");
    if (want && got !== want) console.log("vendor: models/bat_obb.onnx hash mismatch, not installed");
    else { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst); console.log("vendor: bat model ->", dst); }
  }
}

const MIRROR_URL = "https://registry.npmjs.org/pose-landmarker-react-native/-/pose-landmarker-react-native-0.1.0.tgz";
const MODELS = [
  // lite: live camera (real time). full: uploaded clips (accuracy). Hashes pinned; "full" is byte-identical in two independently
  // published packages (pose-landmarker-react-native, vision-camera-pose-landmarks-plugin).
  { name: "lite", path: "package/android/src/main/assets/models/pose_landmarker_lite.task", sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a" },
  { name: "full", path: "package/android/src/main/assets/models/pose_landmarker_full.task", sha256: "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad" },
];
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** one file out of a .tgz (ustar), without a tar dependency */
export function untarFile(tgz, wanted) {
  const tar = gunzipSync(tgz);
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const name = (str(345, 500) ? str(345, 500) + "/" : "") + str(0, 100);
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const body = off + 512;
    if (name === wanted) return tar.subarray(body, body + size);
    off = body + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let mirror = null;
for (const m of MODELS) {
  const dst = join(root, `public/models/pose_landmarker_${m.name}.task`);
  if (existsSync(dst)) { console.log(`vendor: pose model ${m.name} present (sha256 ${sha(readFileSync(dst)).slice(0, 12)}…)`); continue; }
  let done = false;
  try {
    const buf = await fetchBuf(`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m.name}/float16/1/pose_landmarker_${m.name}.task`);
    mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, buf); done = true;
    console.log(`vendor: downloaded pose model ${m.name} from Google ->`, dst);
  } catch (e) { console.log(`vendor: Google model URL unreachable for ${m.name} (`, String(e), "), trying the pinned npm mirror"); }
  if (!done) {
    try {
      mirror ??= await fetchBuf(MIRROR_URL);
      const file = untarFile(mirror, m.path);
      if (!file) throw new Error("model not found in the package");
      const h = sha(file);
      if (h !== m.sha256) throw new Error(`SHA-256 mismatch: got ${h}, pinned ${m.sha256}`);
      mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, file);
      console.log(`vendor: installed pose model ${m.name} from the pinned npm mirror (sha256 verified) ->`, dst);
    } catch (e) { console.log(`vendor: could not install pose model ${m.name} (`, String(e), `) - copy pose_landmarker_${m.name}.task to public/models/ manually`); }
  }
}
