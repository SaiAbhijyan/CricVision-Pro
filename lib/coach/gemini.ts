import "server-only";

export interface GeminiOpts { model: string; system: string; user: string; json?: boolean; maxTokens?: number; thinkingLevel?: "low" | "high"; timeoutMs: number }

export const geminiConfig = () => ({
  key: process.env.GEMINI_API_KEY ?? "",
  base: (process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
  liveModel: process.env.GEMINI_LIVE_MODEL ?? "gemini-4-hydrogen",
  reportModel: process.env.GEMINI_REPORT_MODEL ?? "gemini-4-carbon",
});

/** Minimal REST client. The API key never leaves the server. Throws on timeout / non-2xx / empty output. */
export async function generate(o: GeminiOpts): Promise<string> {
  const c = geminiConfig();
  if (!c.key) throw new Error("GEMINI_API_KEY not set");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
  try {
    const res = await fetch(`${c.base}/models/${o.model}:generateContent`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": c.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [{ role: "user", parts: [{ text: o.user }] }],
        generationConfig: {
          temperature: o.json ? 0.4 : 0.7, maxOutputTokens: o.maxTokens ?? 256,
          ...(o.json ? { responseMimeType: "application/json" } : {}),
          ...(o.thinkingLevel ? { thinkingConfig: { thinkingLevel: o.thinkingLevel } } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const j = await res.json();
    const text: string | undefined = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini empty response");
    return text;
  } finally { clearTimeout(timer); }
}
