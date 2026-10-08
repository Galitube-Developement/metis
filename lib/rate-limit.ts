export { requestClientAddress } from "@/lib/request-network";

type RateLimitEntry = { count: number; resetAt: number };
const entries = new Map<string, RateLimitEntry>();
const MAX_ENTRIES = 10_000;

export function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = entries.get(key);
  if (!current && entries.size >= MAX_ENTRIES) {
    for (const [entryKey, value] of entries) {
      if (value.resetAt <= now) entries.delete(entryKey);
    }
    // Never evict active counters: flooding unique keys must not reset a
    // victim's budget or grow the process without bounds.
    if (entries.size >= MAX_ENTRIES) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
    }
  }
  const entry = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  entries.set(key, entry);
  return {
    allowed: entry.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function resetRateLimit(key: string) {
  entries.delete(key);
}
