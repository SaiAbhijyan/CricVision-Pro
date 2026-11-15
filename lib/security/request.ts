import { NextResponse } from "next/server";
import { takeToken } from "./rate-limit";

export const JSON_HEADERS = { "Cache-Control": "no-store" } as const;

const clientKey = (req: Request) =>
  (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);

/**
 * Same-origin guard for state-less POST APIs. Browsers always send Sec-Fetch-Site / Origin on fetch(); a request from
 * another site (CSRF, or someone embedding our endpoint to spend our model budget) is refused. Non-browser clients that
 * send neither header are allowed only when ALLOW_SERVER_CLIENTS=1.
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none" ? null : forbidden();
  const origin = req.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host === new URL(req.url).host) return null; } catch { /* fallthrough */ }
    return forbidden();
  }
  return process.env.ALLOW_SERVER_CLIENTS === "1" ? null : forbidden();
}
const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403, headers: JSON_HEADERS });

/**
 * Per-client bucket plus one shared bucket per scope (20x the per-client budget). The client key comes from a forwarded header
 * that a direct caller can spoof, so the shared bucket is what bounds total spend on the paid model endpoints regardless.
 */
export function rateLimit(req: Request, scope: string, capacity: number, refillPerSec: number): NextResponse | null {
  const r = takeToken(`${scope}:${clientKey(req)}`, { capacity, refillPerSec });
  if (!r.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(r.retryAfterSec) } });
  const g = takeToken(`${scope}:*`, { capacity: capacity * 20, refillPerSec: refillPerSec * 20 });
  return g.ok ? null : NextResponse.json({ error: "busy, try again shortly" }, { status: 429, headers: { ...JSON_HEADERS, "Retry-After": String(g.retryAfterSec) } });
}

/** Read a JSON body with a hard byte cap (the Content-Length header is advisory, so the stream is counted too). */
export async function readJson(req: Request, maxBytes: number): Promise<unknown | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { return null; }
}
