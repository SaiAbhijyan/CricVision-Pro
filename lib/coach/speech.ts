/** Speaks one coaching sentence; cancels any line in flight so cues never queue up. Browser only. */
export function speak(text: string, opts: { rate?: number; volume?: number } = {}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1.08; u.volume = opts.volume ?? 1; u.lang = "en-GB";
  const v = synth.getVoices().find((x) => /en-(GB|IN|AU)/i.test(x.lang)) ?? synth.getVoices().find((x) => x.lang.startsWith("en"));
  if (v) u.voice = v;
  synth.speak(u);
  return true;
}
export const stopSpeaking = () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };
