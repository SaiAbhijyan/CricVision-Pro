# Validation and known limits

## What is proven
The synthetic harness (`npm run validate`) renders a known delivery (sub-pixel ball, motion blur, noise) through a real camera model and runs the full upload pipeline: detector, tracker, 3-D flight fit, audio-free. 32 cases: batter-end and bowler-end cameras, 30/60/120/240 fps, 95-145 km/h.

| Result | Value |
|---|---|
| Reported | 27 / 32 |
| Refused as too uncertain | 5 / 32 (batter-end 30 fps x4, batter-end 60 fps at 125 km/h: dropping a quarter of the track moves the answer by 25-80 km/h) |
| Speed error of reported deliveries, mean abs / max | 1.41 km/h / 5.27 km/h |
| Bounce length error, mean abs / max | 0.08 m / 0.18 m |
| Bounce line error, max | 0.03 m |
| Confident wrong numbers | 0 (gated: any error over 8 km/h at confidence over 0.7 fails) |

The harness validates detector, tracker and fit against **known synthetic physics**. It is not evidence of real-world accuracy.

Also verified: 150+ upload assertions (`scripts/upload-checks.ts`: file validation, frame timing, exact MP4 frame rate, audio impacts under noise/voice/crowd, both camera ends, outliers, duplicate frames, noisy/moving camera flagged, abort, bad calibration), 74 core assertions, and a headless-Chrome run of the production build (H.264 upload, 120 fps auto-detected, calibrate, analyse, report: 124 km/h on a 125 km/h synthetic clip, zero CSP violations).

## Real footage: the user's two broadcast compilations
Both files are TV highlight reels (640x360): many camera cuts, replays, close-ups and slow motion. They exposed problems no synthetic test had, and drove most of the work below. Tools: `scripts/real-pose-frames.cjs` (MediaPipe Pose offline in headless Chrome), `scripts/real-batting.ts`, `scripts/real-clip.ts`.

### Camera cuts
`lib/upload/shots.ts` finds hard cuts and dissolves. On the Kohli reel (225 s) it finds all 19 hard cuts ffmpeg's scene detector finds, plus dissolves ffmpeg misses (58 cuts); on the Starc clip it finds the replay dissolve at 49.2 s. Analysis restarts at every cut; tracks, pose windows and swings never span two shots. The upload screen has **Find camera shots** and **Use this shot**.

### Kohli reel: batting-only analysis (no pitch marks)
MediaPipe found a body in 3,472 of 6,761 frames. First run: 67 "swings", many physically impossible (4-5 m strides, 2 m head drift), from walking, celebrations, fielders and slow-motion replays. Every swing now passes checks before it is shown: enough pose frames, one person throughout (no hip jump faster than a person moves, steady body size), stride up to 1.6 m, head drift up to 60 cm, a real backlift, not running. A downswing over 0.7 s marks slow motion: bat speed is then **not measured** instead of wrong.

Result on the whole reel: 8 swings reported, checked against the frames by eye: **7 are Kohli playing shots**, 4 of them correctly flagged as slow-motion replays (bat speed not measured). The 8th is the bowler in a wide shot, where the biggest person is not the batter: batting-only mode has **Tap the batter** (pose then follows the person nearest the tap). Recall is low: the reel holds many more shots, and most are rejected because single-person pose loses or swaps the batter at cuts. Some individual figures are doubtful (a front-on drive read 4% front-foot weight; swing path saturates at ±90° on some shots): they are labelled estimates, not validated. Weight transfer from a front-on long lens is marked **not measured**: the stride is along the camera's line of sight, where a single camera cannot see depth (side-on footage measures it).

#### Second pass: the app's own pose model on the whole reel
The first pass used a different offline pose build. `scripts/real-pose-tasks.cjs` now runs the app's own MediaPipe Tasks landmarker (same self-hosted `.task` file, CPU, up to 4 people) over every frame, and `scripts/real-batting.ts` replays the app's batting path on it. Fixes driven by this run:

| Problem seen | Cause | Fix |
|---|---|---|
| "Tracked body jumped" rejections | biggest person picked independently per frame, so the tracker hopped to fielders | `SubjectFollower` keeps the same person (nearest to the last position), waits through short dropouts, resets at camera cuts |
| 0% front-foot weight, swing path stuck at −90° | MediaPipe swaps left and right on front-on and back views | `fixLeftRight`: in the stance, the nose sits on the bowler side of the hips; labels are swapped back when 75%+ of stance frames disagree (13 swaps corrected on this reel) |
| Implausible weight and path figures from front-on cameras | stride is along the line of sight | `stanceAxisToCameraDeg`: pitch axis within 35° of the line of sight marks weight and swing path **not measured** |
| Too few tracked frames around each swing | uploads ran pose at half rate and the check asked for an absolute frame count | full 30 Hz pose for batting uploads; coverage is judged relative to the pose rate |
| Weaker landmarks than the offline run | uploads used the lite model | uploads use the full model; live keeps lite for frame rate |

Result: 5 swings, all Kohli (41.1, 94.0, 141.2, 143.3 and 206.3 s); the bowler false positive from the first pass is gone. 143.3 s overlaps a broadcast zoom-out, so its figures are doubtful. Body found in 43% of frames. Recall is still the weak point: highlight reels cut away before or during most shots.

### Pose model supply chain
Both pose models are self-hosted and SHA-256 pinned (`scripts/vendor-mediapipe.mjs`). Google's download host is unreachable from some networks, so the script falls back to the copy inside an npm package and verifies the hash. Checked with the REA reverse-engineering toolkit: the lite `.task` is a ZIP of exactly two TFLite graphs (`pose_detector.tflite`, `pose_landmarks_detector.tflite`), nothing executable; the full model's hash matches across two independent npm publishers. A production run makes zero third-party requests.

### Pose start-up can no longer hang a session
Live mode used to wait for a GPU-only pose start with no timeout, so on a renderer whose WebGL never answers the session sat on "Loading pose model…" and never tracked the ball (seen in headless Chrome with a software GPU). `startPose` now tries GPU then CPU, each bounded by a timeout, and closes any late instance. Live ball tracking starts at once; body tracking attaches when ready, and the status line says which delegate is running or that only ball tracking is available.

### Starc first ball: ball tracking on TV footage
The broadcast camera zooms 6x and pans through the run-up and delivery, so a fixed-camera tracker cannot work. Built camera-motion compensation (`lib/cv/stabilise.ts`): zoom and pan between frames estimated from the picture, drift limited by direct 6-frame registration, sub-pixel bias removed (pre-smoothing; without it a still camera read as a 0.15%/frame zoom). Synthetic check: a 1.5x zoom with pan is tracked to 0.04 px across the clip; a still camera reads exactly still and is then not compensated at all.

With compensation the real ball **is** found (a smooth 5-point track at 5.00-5.16 s, fit error 1.1 px, centre 148 km/h), but 5 positions at 25 fps from a long lens behind the bowler cannot pin speed down: the honest uncertainty is ±60 km/h, and dozens of random smooth 5-point fragments fit just as well. The app refuses it ("too uncertain") rather than print a number. A real speed from TV footage needs higher frame rate or resolution than this file has.

### Uncertainty that covers systematic error
The fit's own sigma only measures random scatter. On textured backgrounds the tracked ball drifts a few pixels near the camera, which moved some synthetic speeds 20-35 km/h while the fit still claimed ±1. The fit now also runs a jackknife: each quarter of the track is left out and the flight refitted, keeping the better of a local refit from the full answer and a fresh search. If the answer moves, the uncertainty shows it. Anything above ±20 km/h, or below 35% confidence (50% for extra tracks found offline), is refused with the reason, never shown as a number. Checked on textured synthetic clips with a zooming camera: the cases that were 7.6 and 36 km/h wrong are refused (±21, ±42); the ones within 2-6 km/h are reported.

## Live camera, end to end
Headless Chrome with a fake camera looping a synthetic 130 km/h delivery (`--use-file-for-fake-video-capture`), drag-calibrated through the real UI, 30 s per run: camera 2.2 m high, 6 of 6 deliveries at 128.2-130.3 km/h (±1.5-4.1); camera 1.3 m high, 7 of 7 at 125.8-129.3 km/h, each flagged ±5 km/h with advice to raise the camera. This run found and fixed: the CSP blocking the audio detector (live never started), GPU-only pose init with no timeout, pose starving ball tracking, live mode applying no refusal policy, calibration buttons covering the handles, the flight fit failing when the camera is at release height, a stuck fit worker blocking every later ball, and speed reported at the first tracked point instead of release. Comparison with Fulltrack, CrickTrackAI and bat-tracking research: [BENCHMARK-VS-LEADERS.md](BENCHMARK-VS-LEADERS.md).

## What is not proven
- **No radar-gun comparison yet.** Every speed is labelled an estimate. Neither supplied clip can give a validated speed (see above). Needed: a fixed-camera clip (tripod, 60 fps or more) of a delivery with a known speed.
- **Live camera on real hardware** (only a fake camera feed so far).
- **Swing, turn and spin** are unvalidated approximations.
- **Bat speed** is about 3x hand speed, not checked against a sensor.

## Security status
Per-request CSP nonce (no `unsafe-inline` scripts), same-origin guard, body caps, per-client plus shared rate limit (in-memory per instance: put a WAF/edge limiter in front for multi-instance), uploads stay on the device. The pose model still loads from a CDN unless self-hosted (`npm run vendor:models`).
