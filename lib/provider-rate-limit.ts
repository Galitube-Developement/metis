/** Only provider evidence with both an explicit limit and a future reset is resumable. */
export type ProviderRateLimit = {
  resetAt: string;
  detectedAt: string;
  source: "provider-field" | "retry-after" | "provider-message";
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
function timestamp(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== "string") return NaN;
  if (/^\d+(?:\.\d+)?$/.test(v)) return timestamp(Number(v));
  // A date/time without an explicit zone is ambiguous; never assume the server's zone.
  if (!/(?:Z|[+-]\d\d:\d\d|GMT)$/i.test(v)) return NaN;
  return Date.parse(v);
}

function resetHeader(v: unknown, now: number, deltaSeconds = false): number {
  if (deltaSeconds && (typeof v === "number" || typeof v === "string") && /^\d+(?:\.\d+)?$/.test(String(v))) return now + Number(v) * 1000;
  if (typeof v === "string" && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(v)) {
    const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
    const duration = [...v.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce((sum, part) => sum + Number(part[1]) * units[part[2]], 0);
    return now + duration;
  }
  return timestamp(v);
}
export function isProviderUsageLimit(value: unknown): boolean {
  const r = record(value);
  const code = String(r.code ?? r.type ?? r.error_code ?? "");
  const status = r.statusCode ?? r.status;
  if (typeof status === "number" && status !== 429) return false;
  if (/^(?:insufficient_quota|credits_required|billing_hard_limit_reached|invalid_api_key|permission_denied)$/.test(code)) return false;
  const message = typeof value === "string" ? value : typeof r.message === "string" ? r.message : "";
  return status === 429 ||
    /^(?:rate_limit_exceeded|rate_limit_error|usage_limit_reached|usage_limit_exceeded|quota_exceeded)$/.test(code) ||
    /(?:you(?:'ve| have)? (?:hit|reached) (?:your |the )?usage limit|rate limit (?:exceeded|reached)|usage limit (?:exceeded|reached))\b/i.test(message);
}
export function providerRateLimit(error: unknown, now = Date.now()): ProviderRateLimit | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): ProviderRateLimit | null => {
    if (!value || depth > 6 || seen.has(value)) return null;
    seen.add(value);
    const r = record(value);
    const message = typeof value === "string" ? value : typeof r.message === "string" ? r.message : "";
    // Explicit non-rate HTTP/billing errors must not be rescued by a nested message.
    const status = r.statusCode ?? r.status;
    if (typeof status === "number" && status !== 429) return null;
    if (/^(?:insufficient_quota|credits_required|billing_hard_limit_reached|invalid_api_key|permission_denied)$/.test(String(r.code ?? ""))) return null;
    const limited = isProviderUsageLimit(value);
    if (typeof r.responseBody === "string") {
      try {
        const body = record(JSON.parse(r.responseBody));
        const bodyCode = record(body.error).code ?? body.code;
        if (/^(?:insufficient_quota|credits_required|billing_hard_limit_reached)$/.test(String(bodyCode ?? ""))) return null;
      } catch { /* non-JSON body */ }
    }
    const headers = record(r.responseHeaders ?? r.headers);
    const header = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
    const make = (ms: number, source: ProviderRateLimit["source"]) =>
      Number.isFinite(ms) && ms > now && ms <= 8.64e15
        ? { resetAt: new Date(ms).toISOString(), detectedAt: new Date(now).toISOString(), source } : null;
    if (limited) {
      const resets = [
        ...[r.resetAt, r.resetsAt, r.reset_at, r.resets_at, r.resetTime, r.nextResetTime].map(timestamp),
        ...["x-ratelimit-reset", "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests", "anthropic-ratelimit-requests-reset", "anthropic-ratelimit-tokens-reset"].map(name => resetHeader(header(name), now)),
        resetHeader(header("ratelimit-reset"), now, true),
      ].filter(v => Number.isFinite(v) && v > now);
      if (resets.length) return make(Math.max(...resets), "provider-field");
      const retry = header("retry-after") ?? r.retry_after ?? r.retryAfter;
      if (typeof retry === "number" || typeof retry === "string") {
        const seconds = Number(retry);
        const parsed = make(Number.isFinite(seconds) ? now + seconds * 1000 : timestamp(retry), "retry-after");
        if (parsed) return parsed;
      }
      const absolute = message.match(/(?:reset(?:s|ting)?(?: at| on)?|try again (?:at|after))\s*[:=]?\s*(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d))/i);
      if (absolute) return make(timestamp(absolute[1]), "provider-message");
      const relative = message.match(/(?:try again|retry|reset(?:s)?) in\s+(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?)\b/i);
      if (relative) return make(now + Number(relative[1]) * ({ second: 1000, minute: 60000, hour: 3600000 }[relative[2].toLowerCase().replace(/s$/, "")] ?? 0), "provider-message");
    }
    for (const key of ["cause", "error", "data", "rate_limit_info"]) {
      const found = visit(r[key], depth + 1);
      if (found) return found;
    }
    if (typeof r.responseBody === "string") {
      try { return visit(JSON.parse(r.responseBody), depth + 1); } catch { /* not JSON */ }
    }
    return null;
  };
  return visit(error, 0);
}

/** Preserve original SDK fields/headers through adapters that need a readable message. */
export function providerErrorWithCause(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}
