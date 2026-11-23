# Datasets: what was gathered, what it is for, and what it showed

Every dataset and model here came from GitHub or a package registry. From the build machine Hugging Face, Kaggle, Roboflow, Google Drive, Cricsheet, COCO, Open Images, Zenodo, Figshare and archive.org were unreachable, so anything hosted only there is listed under "Fetch by hand". `bash scripts/datasets/fetch.sh` clones the whole set into `./datasets` (git-ignored, about 2.5 GB).

Pickled weights (`.pt`, `.pth`, `.pkl`) from other people's repos can run code when loaded. None was loaded: `scripts/datasets/scan_pickle.py` lists a pickle's imports without unpickling it, and models were either trained here from published base weights or run from ONNX.

## Catalogue

| Repo | What it holds | Licence | Used for |
|---|---|---|---|
| [SaarimFarooqui/cricket-bat-detection-yolov8](https://github.com/SaarimFarooqui/cricket-bat-detection-yolov8) | 882 cricket frames, every bat as an **oriented box** (756 train / 94 valid / 32 test) | MIT | **Bat model trained here** (below) |
| [ritesh-ojha/IPL-DATASET](https://github.com/ritesh-ojha/IPL-DATASET) | 295,732 IPL deliveries 2008-2024, 1,243 matches | MIT (data from [Cricsheet](https://cricsheet.org), ODC-By: credit Cricsheet) | **Simulator calibration** (`data/ipl-phase-rates.json`) |
| [samarpan-rai11/Nepal-ODI-Ball-By-Ball-Data](https://github.com/samarpan-rai11/Nepal-ODI-Ball-By-Ball-Data) | 39,918 ODI deliveries | CC0 | spare ball-by-ball set (50-over formats) |
| [irfan092-ai/cricket-ball-detection-yolov8](https://github.com/irfan092-ai/cricket-ball-detection-yolov8) | 31 labelled cricket-ball images | MIT | too small to train on; a real-image test set |
| [KayanShah/Cricket_LBW_Review](https://github.com/KayanShah/Cricket_LBW_Review) | 2 delivery videos + LBW code | MIT | test footage |
| [alenzenx/TrackNetV3](https://github.com/alenzenx/TrackNetV3), [qaz812345/TrackNetV3](https://github.com/qaz812345/TrackNetV3), [TrackNetV4](https://github.com/TrackNetV4/TrackNetV4), [nickluo/TrackNetV3](https://github.com/nickluo/TrackNetV3) | heatmap ball trackers; 46 badminton videos | MIT | architecture for a future cricket ball model (weights are on Google Drive) |
| [VKorpelshoek/GridTrackNet](https://github.com/VKorpelshoek/GridTrackNet) | tennis ball tracker + weights | MIT | same |
| [wendyminai/Tennis-Ball-Tracking-and-Detection](https://github.com/wendyminai/Tennis-Ball-Tracking-and-Detection) | tennis tracking | Unlicense | same |
| [RITIK-12/CricketShotClassification](https://github.com/RITIK-12/CricketShotClassification) | shot classifier weights | MIT | future shot-type model |
| [kafle1/pocket-drs](https://github.com/kafle1/pocket-drs) | one-phone DRS app and paper | **AGPL-3.0** | ideas only (stump calibration, bounce as a metric anchor); no code or weights copied |
| [kushagra3204/cricket-ball-trajectory-prediction](https://github.com/kushagra3204/cricket-ball-trajectory-prediction), HarshSingh18/CV_Project, Shiveshrane/Cricket_ball_speed-estimation, Kanav123/Cricket-ball-Tracking | YOLOv8 cricket-ball weights, frames | **none** (all rights reserved) | evaluation only, never shipped |
| RashedIfty/Cricket-ShotDataset, muaz-urwa/Cricket-Shot-Classification, nikk-16/Cricket-pose-modelling, gouthamvgk/deep_cricket, share2code99/baseball_cricket_bat_detection, ChgygLin/TrackNetV2-pytorch, yastrebksv/TrackNet, nayan-kasireddi/Cricket-Swing-Analyzer | shot images, pose models, bat images | none | not used |

## What they showed

### Bat tracking (new)
YOLOv8n-OBB trained here (`scripts/datasets/train_bat_obb.py`, CPU, 512 px) from Ultralytics' published `yolov8n-obb` on the MIT bat set. The long axis of each box is the bat; the end nearer the batter's hands is the handle (`lib/cv/bat.ts`).

| Test | Result |
|---|---|
| Held-out test split (32 images), through the app's own TypeScript decoder | 32/32 bats found, no false boxes; bat ends within a median 3.8% of bat length (p90 7.7%); bat angle within a median 1.3° (p90 4.1°) |
| Unseen broadcast footage (Kohli reel, 20 frames around 4 real swings) | the drawn line lies on the bat in every frame where one is found; found in about half: misses when the bat is edge-on or behind the body |

The test split comes from the same videos as the training frames, so the first row flatters it; the second row is the honest number. Bat metrics are therefore shown only when the bat was found in at least 40% of the frames around contact, and each swing says when it was not.

### Learned ball detector: does not generalise
The kushagra YOLOv8 ball model reports mAP50 0.995 on its validation set. Run (as ONNX) on its own test video it tracks the ball cleanly (45/90 frames, confidence ~0.6). On the Starc broadcast clip it fires on 9 of 15 frames at confidence 0.15-0.39 with positions that jump between frames: the validation frames came from the same few videos it was trained on. A learned ball detector needs varied, licensed footage, which is not reachable from here (see below). The app keeps its classical detector plus physics fit.

### Match simulator vs 295,732 real IPL deliveries
The simulator was badly unrealistic. Powerplay, pace, batter skill 0.6 (`npm run calibrate`):

| | Before | After | IPL powerplay |
|---|---|---|---|
| Run rate | 16.0 | 9.0 | 7.82 |
| Dot balls | 33.7% | 39.9% | 42.1% |
| Singles | 1.7% | 28.6% | 26.8% |
| Fours | 37.9% | 20.3% | 16.1% |
| Sixes | 5.1% | 5.3% | 4.2% |
| Wickets | 11.9% | 3.8% | 3.79% |
| Wides | 6.5% | 2.9% | 3.46% |
| No-balls | 9.4% | 1.1% | 0.39% |

What changed, each for a cricket reason: overstepping 4% → 0.4% and return-crease drift 3% → 0.2%; fewer deliberate wide lines; fielders gather and release in 0.65 s, throw 25 m/s and need 0.5 s to break the stumps (were 0.45 s, 27 m/s, 0.25 s), with a 1.5 m diving reach; a single takes 3.0 s, each further run 2.9 s; outfields slow a rolling ball faster (Medium 1.8 m/s²); bat face geometry gives ~10% played-and-missed and ~9% edges; catches are dropped by difficulty (55-90% taken), the bowler in his follow-through reacts later with less reach; drives, cuts and flicks are mostly kept down; a new soft push into the widest gap between ring fielders, which is where most real singles come from; and the gap between bat and pad, so a ball that beats a forward stroke can bowl the batter instead of always striking the pad (bowled had never happened). Remaining gaps: death overs give too many twos and too few singles (run rate ~8.6 vs 9.75); LBW is over-represented among dismissals (~28% vs ~10% real; bowled ~28% vs ~18%, caught ~44% vs ~60%, small sample); the leg-side wide law for limited overs is not modelled.

## Fetch by hand (licensed, but blocked from the build machine)

| Dataset | Why | Licence |
|---|---|---|
| Roboflow "cricket ball tracker v1" (uopcrictrakcr), ~2,000 video frames | the varied cricket-ball footage a learned detector needs | CC BY 4.0 |
| Roboflow "Cricket Ball - v2 CricV2" (cricket-ball-zgk1s), ~170 frames | same | CC BY 4.0 |
| Open Images V7 "Cricket ball" / "Tennis ball", COCO 2017 "sports ball" | photo variety, motion-blur augmentation | boxes CC BY 4.0, images CC BY / CC BY-SA |
| Cricsheet (all formats, ball by ball) | Test/ODI/T20I calibration beyond the IPL | ODC-By 1.0 |
| TrackNetV3 checkpoints (Google Drive) | starting weights for a cricket heatmap tracker | MIT |

Drop the two Roboflow YOLO exports into `datasets/roboflow/` and the same training recipe as the bat model applies (detect task instead of OBB).

## Licensing notes
* The bat model is fine-tuned from Ultralytics' `yolov8n-obb`, which Ultralytics publishes under **AGPL-3.0**; Ultralytics treats models trained from it as covered too. This repository has **no LICENSE file yet**: choose one compatible with AGPL-3.0 (or obtain an Ultralytics enterprise licence) before distributing builds that include `models/bat_obb.onnx`.
* IPL figures in `data/ipl-phase-rates.json` derive from Cricsheet data: keep the attribution in that file.
