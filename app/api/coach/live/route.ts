import { NextResponse } from "next/server";
import type { BallRecord } from "@/lib/types";
import { generate, geminiConfig } from "@/lib/coach/gemini";
import { ballDigest } from "@/lib/coach/digest";
import { LIVE_SYSTEM, liveUser } from "@/lib/coach/prompts";
import { offlineLiveTip } from "@/lib/coach/offline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let ball: BallRecord, history: string[] = [];
  try { const b = await req.json(); ball = b.ball; history = Array.isArray(b.history) ? b.history.slice(-3).map(String) : []; if (!ball) throw 0; }
  catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const c = geminiConfig();
  if (!c.key) return NextResponse.json({ text: offlineLiveTip(ball), source: "offline-rules" });
  try {
    // thinking_level "low" + tiny token cap keeps latency under the 1.5 s budget
    const raw = await generate({ model: c.liveModel, system: LIVE_SYSTEM, user: liveUser(ballDigest(ball), history), maxTokens: 60, thinkingLevel: "low", timeoutMs: 1300 });
    const text = raw.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").split(/(?<=[.!?])\s/)[0].slice(0, 220);
    return NextResponse.json({ text, source: "gemini-4-hydrogen" });
  } catch {
    return NextResponse.json({ text: offlineLiveTip(ball), source: "offline-rules" });
  }
}
