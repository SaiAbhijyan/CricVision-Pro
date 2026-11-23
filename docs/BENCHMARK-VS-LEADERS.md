# CricVision Pro vs how the leading apps do it

How Fulltrack AI, CrickTrackAI and bat-tracking research solve each problem, what CricVision Pro had before this round, what changed, and what was measured. "Before" is the last pushed commit (a25a074). Every number under "Result" was measured in this repo; none comes from a real radar gun yet.

## Source check first

Several pages cited for these techniques do not say what they were cited for. What each one actually supports:

| Source | What it really says | What it does **not** say |
|---|---|---|
| [Fulltrack FAQ](https://www.fulltrack.ai/faq) | 6 stumps (3 per end) aligned inside red boxes on screen; tripod "ideally 1.3 meters", "no taller than 1.3 meters", about 4 m behind the non-striker's stumps; bowlers must not block the camera | anything about the model, frame rate or 3D method |
| [Fulltrack home](https://www.fulltrack.ai/) | stumps are the calibration ("bad calibrations lead to bad tracking"); "tripod taller than 60 inches" | contradicts its own FAQ on height (60 in = 1.52 m vs "no taller than 1.3 m") |
| [Fulltrack technology page](https://www.fulltrack.ai/technology) | "advanced machine learning", 3D ball tracks, pitch maps | no technical detail at all |
| [Shorter et al. 2024, IJSSC](https://doi.org/10.1177/17479541241284714) | 1,081 deliveries vs a Stalker radar: Fulltrack **overestimates** pace by 0.72-0.77 m/s (about 2.6-2.8 km/h), spin by 1.09-1.18 m/s | |
| [Tissera et al. 2024, Sports Biomechanics](https://biomed.reviewer.ly/app/publication/091abbcc-a79c-44f5-b2f2-a148388f30cb) | Fulltrack line/length vs 3D motion capture: ICC > 0.96, SEM 0.05 m | |
| [CrickTrackAI guide](https://cricktrackai.in/blogs/cricket-ai-video-analysis-guide.html) | 33 keypoints, markerless; front knee 165-180° as the braced target; claims release speed within ±2-3 km/h of radar (no study cited) | stump calibration, motion-triggered clips, YOLO/Kalman/RANSAC, kinetic chain, bat tracking |
| [CrickTrackAI vs competitors](https://cricktrackai.in/blogs/cricktrackai-vs-competitors-software-hardware.html) | flags: head tilt 6° off-line, front knee under 110°, trunk flexion over 28°; written by CrickTrackAI's founders, no accuracy figures; CrickTrackAI does **not** track the ball | which pose model it uses |
| [RipIQ swing guide](https://ripiq.app/swing-analyzer-guide/) | baseball swing tools: video apps vs bat sensors vs ball-flight monitors | audio impact detection, bat keypoints |
| [LearnOpenCV: Kohli flick](https://learnopencv.com/decoding-virat-kohlis-flick-shot-ai-based-3d-motion-reconstruction/) | bat handle and tip keypoints from a YOLO pose model plus a depth map, for a 3D swing plane from one video | real-time use or accuracy against sensors |
| [TrackNetV3 (ACM MM Asia 2023)](https://github.com/qaz812345/TrackNetV3) | heatmap tracker over consecutive frames: 97.5% accuracy vs YOLOv7 57.8% on shuttlecocks | cricket |

The motion-triggered high-fps clip and the "Vy flips sign" bounce rule are reasonable engineering but no cited page describes them as what these apps do.

## Ball tracking

| Technique (as described) | CricVision Pro before | What changed this round | Result | Gap left |
|---|---|---|---|---|
| **Anchor calibration from standard stumps** (Fulltrack: 2 sets of 3 stumps in red boxes, ~4 m behind, 1.3 m tripod) | 4 pitch-corner handles (popping creases) + top of the batter's middle stump (71.1 cm); DLT homography; refused above 8 px reprojection error | Default handles moved to a realistic rig and clamped inside the frame; **the button bar was covering the bottom handles and the stump handle** (desktop) and three of five handles on a phone: moved below the video; handles are now 44 px touch targets (were ~5 px on a 390 px phone); camera height is recovered from the calibration (C = −Rᵀt) | Every handle reachable on desktop and phone (headless Chrome hit test); camera height recovered exactly (1.3 / 2.2 / 2.4 m) | **No stumps-only mode.** Nets often have no painted crease corners, which is why Fulltrack uses stumps. Next item. |
| **Camera height** | not checked | Measured on identical synthetic deliveries (130 km/h): 1.3 m read **125** km/h, 2.2 m **128-130**, 2.4 m **128-131**, 3 m **129-130**. Below 2 m the app now floors the speed uncertainty at ±5 km/h and tells the user to raise the camera; setup text asks for 2-2.5 m, ~5 m back | Honest error bar on low rigs | **Disagrees with Fulltrack's 1.3 m.** Our result is our fitter on synthetic data, not a real-world test; Fulltrack's own pages disagree with each other. Needs a radar session at both heights. |
| **Camera at release height** | not handled | A camera ~2.2 m high sees the release point on the horizon line; the fit seeded by height went to infinity (a clean 130 km/h ball fitted as 90 or 144-168 km/h, release 54-139 m behind the bowler). The fit now also seeds by distance along the pitch | Same ball: **129.9 km/h**, release (−0.49, 1.04, 2.20) m vs true (−0.5, 1.0, 2.2) | |
| **High-fps, motion-triggered clipping** | continuous processing at 480 px with a 6 s frame ring; tripod/thermal-saver mode | Ball tracking now gets every frame: pose runs only as often as its measured cost allows and never during a flight when it costs more than a frame; tracking continues while a ball is being fitted; the status line shows "tracking N of M fps · body K fps" and warns when the device is too slow | Software-GPU test machine: tracking 53-59 of 55-60 fps (was 3-15 fps while pose ran) | Browsers rarely give more than 60 fps from `getUserMedia`; no 120-240 fps capture like a native app. |
| **Ball detector: YOLO/CNN + Kalman + RANSAC** | classical: frame differencing, zoom/pan compensation, Kalman, tracker pool + offline hypotheses, robust refit dropping outliers | unchanged | | **No learned detector.** TrackNet-style models are far better on small blurred balls (97.5% vs 57.8% on shuttlecocks) but need labelled cricket footage to train. |
| **Interpolating through occlusion** (ball behind head or net pole) | physics fit across gaps; robust refit | verified on a track with a 7-frame gap at the bounce | fitted to 1.05 px | |
| **3D trajectory and release speed** | 8-parameter physics fit (gravity, drag, Magnus, swing) to pixels; reported the speed at the **first tracked point** | Speed is now carried back to the release point by shooting through the physics model (radar and Hawk-Eye quote release speed). At 480 px the far-end ball is seen ~4.5 m late; drag costs about 1 km/h per metre | Low-rig live case 122.9 → 125.7 km/h | |
| **Bounce point and swing vs seam** | bounce from the fitted flight; swing and seam/turn measured against a "normal ball" with the same release and no swing or spin | unchanged | bounce length error mean 0.08 m, max 0.18 m (32-case matrix) | Swing/spin magnitudes from one camera are unvalidated. |
| **Refusing bad numbers** | uploads refused fit error > 8 px, confidence < 35%, ±20 km/h; **live mode refused nothing** (a gappy track printed 171 km/h) | One shared gate (`gateFlight`) for live and uploads | Live scatter 77-171 km/h → refused or 122-131 km/h | |
| **Fit speed** | ~32-41 s per ball on a 2-core box (README claimed ~3 s); a timed-out worker made every later ball time out too | Screen 14 starts cheaply and polish the best 3; robust refits start from the current answer; the uncertainty profile runs once; a timed-out worker is replaced | **41 s → 11.7 s**, identical answer; 32-case matrix mean error 1.58 → 1.41 km/h, max 6.08 → 5.27 | Still slower than the README's old claim on weak hardware. |

## Body tracking

Round 2 added the **dynamic centre of pressure** (zero-moment point: CoM − z/(g + z̈)·CoM̈) as "Pressure on front foot" next to the static weight: it is exact on synthetic physics (constant velocity equals static, braking shifts it by z·a/g) and refuses frames where the pose is too noisy for a second derivative (reported with 0.3 cm pose noise, refused at 1 cm and above).


| Technique | CricVision Pro before | What changed | Result | Gap left |
|---|---|---|---|---|
| **33-keypoint pose** (MediaPipe / RTMPose / HRNet) | MediaPipe Pose (lite) from a CDN | Self-hosted, SHA-pinned lite (live) and full (uploads) models; `startPose` tries GPU then CPU with timeouts; one person followed through a clip; MediaPipe left/right swaps fixed from the stance | Live session no longer stuck on "Loading pose model…" when the GPU never answers; 13 L/R swaps corrected on the Kohli reel | No RTMPose/HRNet option. |
| **Kinetic chain** (hips → shoulders → elbows → wrists) | peak-speed order hips → shoulders → hands (`chainOrdered`), timing chain chart | unchanged | | Uses linear speeds, not angular velocities; no elbow stage. |
| **Head-to-base alignment** (head over front foot; 6° tilt flag) | lateral head drift stance → contact | **Added** head over front foot at contact (cm along the pitch, + = falling back); hidden when the camera looks along the stride | moving the head 25 cm back moves the figure 25.0 cm (check in `scripts/checks.ts`) | No head-tilt angle. |
| **Front-knee brace** (165-180°) | front knee at release, `kneeBraced` above 165°, collapse from front-foot contact | unchanged | | |
| **Hip-shoulder counter-rotation** | separation (X-factor) and counter-rotation, flagged above 30° | unchanged | | |
| **View validity** | all figures shown regardless of angle | weight transfer and swing path marked "not measured" when the pitch axis is within 35° of the line of sight | Kohli reel: front-on shots no longer give 0% front foot or −90° path | |

## Bat swing

| Technique | CricVision Pro before | What changed | Result | Gap left |
|---|---|---|---|---|
| **Bat keypoints (handle top, toe)** | bat inferred from the hands' path and wrist snap; bat speed labelled an estimate | **Built (round 2):** YOLOv8n-OBB trained here on an MIT set of 882 oriented bat boxes; the box's long axis is the bat, the end nearer the hands is the handle; runs in the browser (ONNX Runtime, self-hosted) on the frames around each swing; bat angle at contact, bat lift, angular speed, toe speed (`models/README.md`) | held-out: ends within 3.2% of bat length (median), angle 1.3°; unseen broadcast: found in 12/20 frames, always on the bat; tracked a real swing in Chrome (straight bat, 1.3°) | 2-D only (no depth model, so no 3-D swing plane); live mode does not run it yet; calibrated (ball + bat) uploads do not run it yet |
| **Audio impact sync** (2-5 kHz transient) | AudioWorklet onset detector, 2-5 kHz band, sharp vs dull classification, mapped onto video time | **The production CSP blocked it**: the fallback core and uploads ran the detector through `new Function`, which the CSP rightly forbids, so `new ImpactDetector()` threw and live mode never started. Now a real class; the worklet keeps its own copy; a check proves both give identical events and fails the build if any client code evaluates strings | Live session starts under the production CSP, 0 errors | Not tested against a real bat at a net. |
| **Exit-vector projection** | exit direction and speed from post-impact motion, projected onto the field | unchanged | | Monocular approximation (see README §4.6). |

## Real footage results

| Clip | Result |
|---|---|
| Kohli highlight reel (batting only) | 5 swings, all Kohli (the bowler false positive is gone); 13 left/right swaps corrected; 1 of the 5 overlaps a broadcast zoom-out |
| Starc delivery (ball, TV camera zooming 6x) | ball found after zoom compensation, but 5 points at 25 fps give ±60 km/h: refused, not guessed |

## Where CricVision Pro stands

* **Ahead of the vendor claims on honesty:** every figure carries an uncertainty and is refused when unsupported. Fulltrack's published bias is +2.6-2.8 km/h on pace with no per-ball error bar.
* **On par in method:** stump/pitch-anchored calibration, physics-fitted 3D flight, bounce detection, swing vs seam, 33-point pose metrics, audio contact.
* **Behind:** no learned ball detector (no licensed, varied cricket-ball footage reachable: see `docs/DATASETS.md`), no stumps-only calibration, no high-fps native capture, and **no real-world validation yet**. Round 2 closed the bat-tracking gap (2-D) and calibrated the match simulator against 295,732 real IPL deliveries. The single most useful next step is the same as before: film real deliveries with a radar gun alongside, at 1.3 m and 2.2 m camera heights.

## Tests behind these results

* `npm run validate`: 27/32 synthetic cases reported, 5 refused; speed mean |error| 1.41 km/h, max 5.27; bounce length mean 0.08 m, max 0.18.
* `scripts/checks.ts` 77/77; `scripts/upload-checks.ts` 164/164; `scripts/selfcheck.ts` clean.
* Live camera end to end in headless Chrome with a fake camera looping a synthetic 130 km/h delivery for 30 s: **2.2 m rig, 6 of 6 deliveries scored at 128.2-130.3 km/h (±1.5-4.1)**; **1.3 m rig, 7 of 7 at 125.8-129.3 km/h, each with the ±5 km/h low-camera warning**. Before this round: 0-1 deliveries scored in 30 s. Zero third-party requests, zero console errors.
