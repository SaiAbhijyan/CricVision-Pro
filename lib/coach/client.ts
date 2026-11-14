import type { BallRecord, CoachReport, SessionSummary } from "@/lib/types";
import { offlineLiveTip, offlineReport } from "./offline";
import { speak } from "./speech";

const LIVE_BUDGET_MS = 1400;

/** Live cue: tries the server route under a hard 1.4 s budget, falls back to the offline rules. */
export async function liveCoach(ball: BallRecord, history: string[], opts: { speak?: boolean } = {}): Promise<{ text: string; source: "gemini-4-hydrogen" | "offline-rules"; ms: number }> {
  const t0 = performance.now();
  let text = "", source: "gemini-4-hydrogen" | "offline-rules" = "offline-rules";
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LIVE_BUDGET_MS);
    const res = await fetch("/api/coach/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ball, history }), signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) { const j = await res.json(); if (j.text && j.source === "gemini-4-hydrogen") { text = j.text; source = j.source; } }
  } catch { /* budget exceeded or offline */ }
  if (!text) text = offlineLiveTip(ball);
  if (opts.speak !== false) speak(text);
  return { text, source, ms: Math.round(performance.now() - t0) };
}

export async function fetchReport(s: SessionSummary): Promise<CoachReport> {
  try {
    const res = await fetch("/api/coach/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
    if (res.ok) return (await res.json()) as CoachReport;
  } catch { /* fall through */ }
  return offlineReport(s);
}
