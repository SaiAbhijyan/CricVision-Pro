#!/usr/bin/env bash
# Shallow-clone the cricket and sports datasets catalogued in docs/DATASETS.md into ./datasets (outside git: see .gitignore).
# Licences differ per repo: read the table before using any of it in a shipped build. Usage: bash scripts/datasets/fetch.sh [dir]
set -euo pipefail
DEST="${1:-datasets}"
mkdir -p "$DEST"
REPOS=(
  # licensed for use (MIT / public domain / CC0)
  SaarimFarooqui/cricket-bat-detection-yolov8      # MIT: 882 bat images with oriented boxes (handle-to-toe axis)
  irfan092-ai/cricket-ball-detection-yolov8        # MIT: 31 labelled cricket-ball images
  KayanShah/Cricket_LBW_Review                     # MIT: 2 delivery videos, LBW extrapolation code
  RITIK-12/CricketShotClassification               # MIT: shot classifier (weights only)
  ritesh-ojha/IPL-DATASET                          # MIT (data from Cricsheet, ODC-By): 295,732 IPL deliveries 2008-2024
  samarpan-rai11/Nepal-ODI-Ball-By-Ball-Data       # CC0: 39,918 ODI deliveries
  alenzenx/TrackNetV3                              # MIT: TrackNetV3 code + 46 badminton videos
  qaz812345/TrackNetV3                             # MIT (weights on Google Drive)
  TrackNetV4/TrackNetV4                            # MIT
  nickluo/TrackNetV3                               # MIT
  VKorpelshoek/GridTrackNet                        # MIT: tennis ball tracking + weights
  wendyminai/Tennis-Ball-Tracking-and-Detection    # Unlicense: tennis ball tracking
  Gayathri0-0/multimodal-cricket-motion-analysis   # MIT
  # reference only (AGPL: read for ideas, do not copy code or weights into this repo)
  kafle1/pocket-drs                                # AGPL-3.0: one-phone DRS; documents CC BY 4.0 ball datasets
  # no licence: evaluation only, never shipped
  kushagra3204/cricket-ball-trajectory-prediction  # YOLOv8 cricket-ball weights (ONNX export included)
  HarshSingh18/CV_Project
  Shiveshrane/Cricket_ball_speed-estimation
  Kanav123/Cricket-ball-Tracking
  share2code99/baseball_cricket_bat_detection
  RashedIfty/Cricket-ShotDataset-EfficientNet-ResMLP.
  muaz-urwa/Cricket-Shot-Classification-using-Computer-Vision
  nikk-16/Cricket-pose-modelling
  gouthamvgk/deep_cricket
  ChgygLin/TrackNetV2-pytorch
  yastrebksv/TrackNet
  nayan-kasireddi/Cricket-Swing-Analyzer
)
for r in "${REPOS[@]}"; do
  d="$DEST/${r//\//_}"
  [ -d "$d" ] && { echo "have $r"; continue; }
  GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 "https://github.com/$r.git" "$d" && echo "got  $r ($(du -sh --exclude=.git "$d" | cut -f1))"
done
echo "Pickled weights (.pt/.pth/.pkl) from these repos can run code when loaded: scan them first (python3 -I scripts/datasets/scan_pickle.py <file>)."
