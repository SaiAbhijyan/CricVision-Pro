"""Train the bat model: YOLOv8n-OBB (Ultralytics official weights) on the MIT cricket-bat dataset, then export ONNX for the browser.
Usage: python3 -I scripts/datasets/train_bat_obb.py <dataset dir with train/valid/test> <out dir>
Never loads third-party pickles: the only .pt read is Ultralytics' published base model and our own checkpoints."""
import sys, os
from ultralytics import YOLO
data_dir, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(out, exist_ok=True)
yaml = os.path.join(out, "bat.yaml")
open(yaml, "w").write(f"path: {data_dir}\ntrain: train/images\nval: valid/images\ntest: test/images\nnames:\n  0: bat\n")
m = YOLO("yolov8n-obb.pt")
m.train(data=yaml, epochs=25, imgsz=512, batch=8, workers=2, device="cpu", patience=8, project=out, name="bat_obb", exist_ok=True,
        plots=False, cache=True, fliplr=0.5, degrees=10, mosaic=1.0, close_mosaic=5)
best = YOLO(os.path.join(out, "bat_obb", "weights", "best.pt"))
print(best.val(data=yaml, split="test", imgsz=512, device="cpu", plots=False).box.map)
print(best.export(format="onnx", imgsz=512, opset=17, simplify=True, dynamic=False, device="cpu"))
