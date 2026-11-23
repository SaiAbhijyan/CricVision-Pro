"""Draw bat detections (ONNX) on video frames around given times; save a contact sheet."""
import sys, subprocess, json, numpy as np, onnxruntime as ort
from PIL import Image, ImageDraw
model, video, out = sys.argv[1], sys.argv[2], sys.argv[3]; times = [float(t) for t in sys.argv[4].split(",")]
pr = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", video]))["streams"][0]
W, H = pr["width"], pr["height"]; S = 512
sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"]); name = sess.get_inputs()[0].name
tiles, stats = [], []
for t0 in times:
  for dt in (-0.32, -0.16, -0.08, 0.0, 0.08):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(t0 + dt), "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    im = Image.fromarray(np.frombuffer(raw, np.uint8).reshape(H, W, 3))
    r = min(S / W, S / H); nw, nh = round(W * r), round(H * r); px, py = (S - nw) // 2, (S - nh) // 2
    cv = Image.new("RGB", (S, S), (114, 114, 114)); cv.paste(im.resize((nw, nh), Image.BILINEAR), (px, py))
    y = sess.run(None, {name: np.asarray(cv, np.float32).transpose(2, 0, 1)[None] / 255})[0][0]
    i = int(np.argmax(y[4])); conf = float(y[4, i]); d = ImageDraw.Draw(im)
    if conf > 0.25:
      cx, cy, w, h, a = (y[0, i] - px) / r, (y[1, i] - py) / r, y[2, i] / r, y[3, i] / r, y[5, i]
      L, ang = (w, a) if w >= h else (h, a + np.pi / 2); dx, dy = np.cos(ang) * L / 2, np.sin(ang) * L / 2
      d.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], fill=(255, 40, 40), width=3)
    d.text((4, 4), f"t={t0 + dt:.2f} conf={conf:.2f}", fill=(255, 255, 0)); stats.append(conf)
    tiles.append(im.resize((320, int(320 * H / W))))
cols = 5; th = tiles[0].height; sheet = Image.new("RGB", (320 * cols, th * ((len(tiles) + cols - 1) // cols)))
for k, tl in enumerate(tiles): sheet.paste(tl, ((k % cols) * 320, (k // cols) * th))
sheet.save(out); print("frames", len(stats), "with bat (conf>0.25):", sum(c > 0.25 for c in stats), "median conf", float(np.median(stats)))
