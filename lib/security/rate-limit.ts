/**
 * Tiny in-memory token bucket, keyed by client address. It protects the (paid) coaching endpoints from being hammered
 * and is deliberately dependency-free. On a multi-instance deployment put a shared limiter (WAF / edge) in front too:
 * each instance keeps its own counters.
 */
interface Bucket { tokens: number; at: number }
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export function takeToken(key: string, opts: { capacity: number; refillPerSec: number }, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) { // bounded memory: drop the oldest entries
      const drop = [...buckets.entries()].sort((x, y) => x[1].at - y[1].at).slice(0, MAX_KEYS / 10);
      for (const [k] of drop) buckets.delete(k);
    }
    b = { tokens: opts.capacity, at: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(opts.capacity, b.tokens + ((now - b.at) / 1000) * opts.refillPerSec);
  b.at = now;
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, retryAfterSec: 0 }; }
  return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / opts.refillPerSec) };
}

export const _resetRateLimits = () => buckets.clear();
