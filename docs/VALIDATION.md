# Validation and known limits

## What is proven
The synthetic harness (`npm run validate`) renders a known delivery (sub-pixel ball, motion blur, noise) through a real camera model and runs the full upload pipeline: detector, tracker, 3-D flight fit, audio-free. 32 cases: batter-end and bowler-end cameras, 30/60/120/240 fps, 95-145 km/h.

| Result | Value |
|---|---|
| Deliveries detected | 32 / 32 |
| Speed error, mean abs / max | 3.3 km/h / 37 km/h (one 30 fps, 13-point track, flagged ±20, confidence ≤0.6) |
| Speed error at ≥60 fps | within ±6 km/h (gated) |
| Bounce length error, mean abs / max | 0.08 m / 0.31 m |
| Bounce line error, max | 0.03 m |

The harness validates detector, tracker and fit against **known synthetic physics**. It is not evidence of real-world accuracy.

Also verified: 103 upload assertions (`scripts/upload-checks.ts`: file validation, frame timing, exact MP4 frame rate, audio impacts under noise/voice/crowd, both camera ends, outliers, duplicate frames, noisy/moving camera flagged, abort, bad calibration), 74 core assertions, and a headless-Chrome run of the production build (H.264 upload, 120 fps auto-detected, calibrate, analyse, report: 124 km/h on a 125 km/h synthetic clip, zero CSP violations).

## What is not proven
- **No radar-gun comparison yet.** Every speed is labelled an estimate in the UI. To validate: record a delivery with a radar or use a broadcast clip with an on-screen speed, enter the reading, compare. Target: ±5 km/h.
- **Pose on real footage** (needs the MediaPipe model; not exercised in CI).
- **Live camera on real hardware.**
- **Swing, turn and spin** are unvalidated approximations.

## Real footage findings
- Broadcast clip (Starc, 1080p30): refused. The camera pans and zooms and the file has repeated frames; the fit residual was 73 px, so the app reports no delivery and says the camera moved, instead of printing a wrong speed.
- The app requires a **fixed camera** (tripod/fixed mount). Panning/zooming footage is detected (noise floor) and flagged; speeds from it are unreliable.
- **Repeated frames** (frame-rate conversion) are dropped and flagged; speed can be off 10-20 km/h.
- 30 fps with a short track can be off by tens of km/h; the UI shows ±20 and low confidence.

## Security status
Per-request CSP nonce (no `unsafe-inline` scripts), same-origin guard, body caps, per-client plus shared rate limit (in-memory per instance: put a WAF/edge limiter in front for multi-instance), uploads stay on the device. The pose model still loads from a CDN unless self-hosted (`npm run vendor:models`).
