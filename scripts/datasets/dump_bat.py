"""Run the bat OBB ONNX on test images; dump raw output + letterbox params + ground-truth corners as JSON for the TS decoder."""
import sys, json, os, numpy as np, onnxruntime as ort
from PIL import Image
model, img_dir, lbl_dir, out = sys.argv[1:5]
S = 512; sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"]); name = sess.get_inputs()[0].name
rows = []
for f in sorted(os.listdir(img_dir)):
    im = Image.open(os.path.join(img_dir, f)).convert("RGB"); W, H = im.size
    r = min(S / W, S / H); nw, nh = round(W * r), round(H * r); px, py = (S - nw) // 2, (S - nh) // 2
    canvas = Image.new("RGB", (S, S), (114, 114, 114)); canvas.paste(im.resize((nw, nh), Image.BILINEAR), (px, py))
    x = np.asarray(canvas, np.float32).transpose(2, 0, 1)[None] / 255
    y = sess.run(None, {name: x})[0][0]   # (6, N)
    keep = np.argsort(-y[4])[:60]          # only the strongest candidates are needed by the decoder
    lbl = os.path.join(lbl_dir, os.path.splitext(f)[0] + ".txt")
    gt = [list(map(float, l.split()[1:])) for l in open(lbl) if l.strip()] if os.path.exists(lbl) else []
    rows.append({"f": f, "W": W, "H": H, "n": len(keep), "data": y[:, keep].astype(float).round(4).tolist(), "gt": gt})
json.dump(rows, open(out, "w")); print("dumped", len(rows))
