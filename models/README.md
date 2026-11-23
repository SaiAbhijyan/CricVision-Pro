# Bat model: `bat_obb.onnx`

Cricket bat as an oriented box, read as a two-point skeleton (handle, toe) by `lib/cv/bat.ts`.

| | |
|---|---|
| Architecture | YOLOv8n-OBB, 512 × 512 input, one class, ONNX opset 17, 12.5 MB (fp32) |
| Output | `[1, 6, 5376]`: cx, cy, w, h, score, angle (radians), in input pixels |
| Base weights | Ultralytics `yolov8n-obb.pt` (AGPL-3.0) |
| Training data | [SaarimFarooqui/cricket-bat-detection-yolov8](https://github.com/SaarimFarooqui/cricket-bat-detection-yolov8) (MIT), 756 train / 94 valid / 32 test frames |
| Recipe | `scripts/datasets/train_bat_obb.py`: CPU, 512 px, batch 8, mosaic, flips, ±10° rotation; best of 17 epochs |
| SHA-256 | see `bat_obb.onnx.sha256` (checked by `npm run vendor:models`, which installs it to `public/models/`) |

## Accuracy

| Test | Result |
|---|---|
| Held-out test split (Ultralytics) | mAP50 0.995, mAP50-95 0.811, precision 0.998, recall 1.000 |
| Same split through the app's TypeScript decoder | 32/32 bats, no false boxes; bat ends within a median 3.2% of bat length (p90 5.8%); angle within a median 1.3° (p90 3.0°, max 5.9°) |
| Unseen broadcast footage (Kohli reel, 20 frames at 4 swings) | bat found in 12/20 frames, always on the bat; misses when the bat is edge-on to the camera or hidden by the body |
| In the app (headless Chrome, production CSP) | runtime and model load from this site only; a real swing tracked over 13 frames (coverage 0.59), straight bat at contact (1.3°) |

The test split comes from the same videos as the training frames; the broadcast row is the honest number. Bat speed from this model is the toe's speed in the picture scaled by the bat's own length, so it is exact only when the swing plane faces the camera; slow-motion replays keep their angles but report no speeds.

## Licence
Fine-tuned from AGPL-3.0 weights. Ultralytics treats models trained from them as AGPL-3.0 too, so distribute this file under terms compatible with AGPL-3.0 (or with an Ultralytics enterprise licence). The training images are MIT (© 2026 Ahmed Saarim Uddin Farooqui).
