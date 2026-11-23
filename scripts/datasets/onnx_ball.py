"""Run a YOLOv8 single-class detector (ONNX, no pickle) over video frames; print detections per frame."""
import sys, subprocess, numpy as np, onnxruntime as ort, json
model, video, t0, t1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
conf = float(sys.argv[5]) if len(sys.argv) > 5 else 0.25
probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", video]))["streams"][0]
W, H = probe["width"], probe["height"]; num, den = map(int, probe["r_frame_rate"].split("/")); fps = num / den
raw = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(t0), "-t", str(t1 - t0), "-i", video, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"]); inp = sess.get_inputs()[0]; S = inp.shape[2] if isinstance(inp.shape[2], int) else 640
r = min(S / W, S / H); nw, nh = int(round(W * r)), int(round(H * r)); px, py = (S - nw) // 2, (S - nh) // 2
import time; tt = time.time(); out = []
for k, f in enumerate(frames):
    # letterbox with nearest-neighbour resize (no cv2 dependency)
    ys = (np.arange(nh) / r).astype(int).clip(0, H - 1); xs = (np.arange(nw) / r).astype(int).clip(0, W - 1)
    img = np.full((S, S, 3), 114, np.uint8); img[py:py + nh, px:px + nw] = f[ys][:, xs]
    x = img.transpose(2, 0, 1)[None].astype(np.float32) / 255
    p = sess.run(None, {inp.name: x})[0][0]   # (5, N): cx cy w h score
    sc = p[4]; i = np.argsort(-sc)[:3]
    dets = [((p[0, j] - px) / r, (p[1, j] - py) / r, float(sc[j])) for j in i if sc[j] >= conf]
    out.append((t0 + k / fps, dets))
dt = (time.time() - tt) / max(1, len(frames))
print(f"# {len(frames)} frames {W}x{H} @ {fps:.2f} fps, input {S}, {dt * 1000:.0f} ms/frame")
for t, d in out: print(f"{t:.3f}", " ".join(f"({x:.0f},{y:.0f} {s:.2f})" for x, y, s in d))
