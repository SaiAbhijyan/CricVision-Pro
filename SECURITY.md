# Security model

The browser is untrusted. Vision and physics run on the device; only a compact text digest goes to the coach API.

- **Server never forwards client JSON.** Records are rebuilt from an allowlist (`lib/security/sanitize.ts`), numbers are clamped, at most 150 balls, and only exact allowlisted flag strings pass (the only reliable defence against prompt injection through free text).
- **Same-origin only.** `Sec-Fetch-Site` / `Origin` are checked; header-less clients are refused unless `ALLOW_SERVER_CLIENTS=1`.
- **Rate limits and size caps.** Token bucket per client (live 30 burst / 1.5 per s, report 6 burst / 0.05 per s); body caps 24 KB (live), 900 KB (report).
- **Headers.** CSP, HSTS, X-Frame-Options DENY, COOP/CORP same-origin, no-referrer.
- **Secrets.** The Gemini key stays server-side.
- **Self-hosting.** `npm run vendor:models` copies MediaPipe assets locally; `NEXT_PUBLIC_SELF_HOST_ONLY=1` removes CDN origins from the CSP.

## Known limits
- CSP is built per request in `middleware.ts` with a script nonce (no `unsafe-inline` scripts; every page renders per request). `'wasm-unsafe-eval'` stays for MediaPipe. `style-src` keeps `unsafe-inline` (Tailwind/React inline styles).
- The rate limiter is in memory, so it is per server instance. Use a shared store when scaled out.
- Monocular live tracking is approximate: speed about ±2 km/h, pitch point about 10 cm; swing and spin magnitudes can be off by up to about 15 cm and are partly confounded. Bat speed is an estimate from hand speed.
- The live camera path has not been validated on real hardware.
