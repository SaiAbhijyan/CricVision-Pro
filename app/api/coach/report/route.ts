import { NextResponse } from "next/server";
import type { CoachReport, SessionSummary } from "@/lib/types";
import { generate, geminiConfig } from "@/lib/coach/gemini";
import { sessionDigest } from "@/lib/coach/digest";
import { REPORT_SYSTEM, reportUser } from "@/lib/coach/prompts";
import { offlineReport } from "@/lib/coach/offline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every((i) => typeof i === "string");

function validate(j: unknown): Omit<CoachReport, "source"> | null {
  const o = j as Record<string, unknown>;
  if (!o || typeof o.headline !== "string" || !isStrList(o.whatWentRight) || !Array.isArray(o.whatWentWrong) || !Array.isArray(o.drills)) return null;
  const wrong = o.whatWentWrong.filter((w: any) => w && typeof w.issue === "string").map((w: any) => ({ issue: String(w.issue), rootCause: String(w.rootCause ?? ""), evidence: String(w.evidence ?? "") }));
  const drills = o.drills.filter((d: any) => d && typeof d.name === "string").map((d: any) => ({ name: String(d.name), targets: String(d.targets ?? ""), instructions: String(d.instructions ?? ""), reps: String(d.reps ?? "") }));
  if (!wrong.length || drills.length < 1) return null;
  return { headline: o.headline, whatWentRight: o.whatWentRight, whatWentWrong: wrong, drills: drills.slice(0, 3), injuryRisks: isStrList(o.injuryRisks) ? o.injuryRisks : [] };
}

export async function POST(req: Request) {
  let s: SessionSummary;
  try { s = await req.json(); if (!s?.balls) throw 0; } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const c = geminiConfig();
  if (!c.key) return NextResponse.json(offlineReport(s));
  try {
    const raw = await generate({ model: c.reportModel, system: REPORT_SYSTEM, user: reportUser(sessionDigest(s)), json: true, maxTokens: 2500, thinkingLevel: "high", timeoutMs: 45000 });
    const parsed = validate(JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")));
    if (!parsed) throw new Error("schema");
    return NextResponse.json({ source: "gemini-4-carbon", ...parsed } satisfies CoachReport);
  } catch {
    return NextResponse.json(offlineReport(s));
  }
}
