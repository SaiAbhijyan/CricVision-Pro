import { NextResponse, type NextRequest } from "next/server";

const prod = process.env.NODE_ENV === "production";
const selfHostOnly = process.env.NEXT_PUBLIC_SELF_HOST_ONLY === "1";
// The CDN origins are only the fallback for the MediaPipe runtime and pose model; they are dropped in self-host-only mode.
const cdn = selfHostOnly ? "" : " https://cdn.jsdelivr.net https://storage.googleapis.com";

/** Per-request CSP. Scripts need the request's nonce (or 'self'), so injected inline script does not run. 'wasm-unsafe-eval' lets MediaPipe compile WebAssembly without allowing JavaScript eval. */
export function buildCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${prod ? "" : " 'unsafe-eval'"} blob:${selfHostOnly ? "" : " https://cdn.jsdelivr.net"}`,
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
}

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = { matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }] };
