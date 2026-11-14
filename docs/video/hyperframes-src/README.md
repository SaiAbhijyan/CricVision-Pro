# Film source

`index.html` is the Hyperframes composition (HTML + GSAP, 1920x1080, 30 fps, 115.5 s).
It expects these files in `assets/` (not committed, they are large): `starc.mp4` and `kohli.mp4` (the opening broadcast clips, supplied by the author), `phone.mp4`, `r0_home.mp4`, `r1_live.mp4`, `r2_weight.mp4` (screen recordings of the app), `s_*.png` (report card screenshots, also in `docs/screens`) and `mix.wav`.

`tools/` holds the capture and audio scripts: `rec.py`, `scenes.py`, `scenes2.py` record the app with Playwright and a Chrome CDP screencast; `stills.py` captures the report cards; `vo3.py` generates the voiceover (Kokoro, voice `am_michael`); `mix3.py` builds the score and effects and normalises to -16 LUFS.

Render: `npx hyperframes render` (Node 22+, ffmpeg, Chrome; set `HYPERFRAMES_BROWSER_PATH` if Chrome is not found).
