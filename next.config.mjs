const prod = process.env.NODE_ENV === "production";
const selfHostOnly = process.env.NEXT_PUBLIC_SELF_HOST_ONLY === "1";
// The CDN origins are only the fallback for the MediaPipe runtime and pose model; they are dropped in self-host-only mode.
const cdn = selfHostOnly ? "" : " https://cdn.jsdelivr.net https://storage.googleapis.com";

// Content Security Policy. 'unsafe-inline' for scripts is required by Next's inline bootstrap on statically rendered
// pages (a per-request nonce needs fully dynamic rendering); 'wasm-unsafe-eval' lets MediaPipe compile WebAssembly
// without allowing JavaScript eval. Everything else is same-origin: no remote scripts, frames, forms or plugins.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${prod ? "" : " 'unsafe-eval'"} blob:${selfHostOnly ? "" : " https://cdn.jsdelivr.net"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  `connect-src 'self' blob: data:${cdn}${prod ? "" : " ws: wss:"}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  prod ? "upgrade-insecure-requests" : "",
].filter(Boolean).join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
