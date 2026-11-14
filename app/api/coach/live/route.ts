import { NextResponse } from "next/server";
import { generate, geminiConfig } from "@/lib/coach/gemini";
import { ballDigest } from "@/lib/coach/digest";
import { LIVE_SYSTEM, liveUser } from "@/lib/coach/prompts";
import { offlineLiveTip } from "@/lib/coach/offline";
import { JSON_HEADERS, assertSameOrigin, rateLimit, readJson } from "@/lib/security/request";
import { safeText, sanitizeBall } from "@/lib/security/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (text: string, source: string) => NextResponse.json({ text, source }, { headers: JSON_HEADERS });

export async function POST(req: Request) {
  const bad = assertSameOrigin(req) ?? rateLimit(req, "live", 30, 1.5);
  if (bad) return bad;
  const body = (await readJson(req, 24_000)) as { ball?: unknown; history?: unknown } | null;
  const ball = body ? sanitizeBall(body.ball) : null;
  if (!ball) return NextResponse.json({ error: "bad request" }, { status: 400, headers: JSON_HEADERS });
  const history = Array.isArray(body?.history) ? body!.history.slice(-3).map((h) => safeText(h, 220)).filter((h): h is string => !!h) : [];
  const c = geminiConfig();
  if (!c.key) return reply(offlineLiveTip(ball), "offline-rules");
  try {
    // thinking_level "low" + tiny token cap keeps latency under the 1.5 s budget
    const raw = await generate({ model: c.liveModel, system: LIVE_SYSTEM, user: liveUser(ballDigest(ball), history), maxTokens: 60, thinkingLevel: "low", timeoutMs: 1300 });
    const text = raw.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").split(/(?<=[.!?])\s/)[0].slice(0, 220);
    return reply(text, "gemini-4-hydrogen");
  } catch {
    return reply(offlineLiveTip(ball), "offline-rules");
  }
}
