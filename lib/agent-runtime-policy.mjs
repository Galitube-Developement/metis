export const DEFAULT_AGENT_RUNTIME_MS = 30 * 60_000;
export const MIN_AGENT_RUNTIME_MS = 15 * 60_000;
/** JSON-safe persisted sentinel: no automatic runtime expiry. */
export const UNLIMITED_AGENT_RUNTIME_MS = 0;

/** One persisted runtime policy for delegated and project agent jobs. */
export function normalizeAgentRuntimeMs(value) {
  if (value === UNLIMITED_AGENT_RUNTIME_MS) return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return DEFAULT_AGENT_RUNTIME_MS;
  return Math.max(MIN_AGENT_RUNTIME_MS, value);
}

/** An explicit assignment limit overrides the account default. */
export function resolveAgentRuntimeMs(requested, configuredDefault) {
  return normalizeAgentRuntimeMs(requested ?? configuredDefault);
}

/** Unlimited has no deadline; finite dates stay representable by JavaScript. */
export function agentRuntimeDeadline(start, runtimeMs) {
  return runtimeMs === UNLIMITED_AGENT_RUNTIME_MS ? Infinity : Math.min(start + runtimeMs, 8_640_000_000_000_000);
}

/** Agent budgets, including zero, override the scheduler's global fallback. */
export function workerRuntimeMs(job, fallback) {
  if (job?.parentJobId || job?.projectTeamId) return normalizeAgentRuntimeMs(job.maxRuntimeMs);
  const requested = job?.maxRuntimeMs;
  return typeof requested === "number" && Number.isFinite(requested) && requested > 0
    ? Math.max(60_000, Math.min(requested, 7 * 24 * 60 * 60_000)) : fallback;
}

/** Recheck long deadlines in chunks, avoiding Node's ~24-day timer overflow. */
export function scheduleRuntimeDeadline(deadline, expire) {
  if (!Number.isFinite(deadline)) return () => {};
  let timer;
  let cancelled = false;
  function check() {
    if (cancelled) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { expire(); return; }
    timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    timer.unref?.();
  }
  // Scheduling rather than expiring synchronously lets callers finish setup.
  timer = setTimeout(check, Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647));
  timer.unref?.();
  return () => { cancelled = true; clearTimeout(timer); };
}

export const AGENT_RUNTIME_SCHEMA = {
  type: "integer", minimum: 0,
  anyOf: [{ const: UNLIMITED_AGENT_RUNTIME_MS }, { minimum: MIN_AGENT_RUNTIME_MS }],
  description: "Run limit in milliseconds. Omit to use the owner's Agent Settings (30 minutes when unset). Use 0 for Unlimited, or at least 900000 (15 minutes) for a custom duration; there is no fixed upper runtime limit. Applies to synchronous waiting and wait=false.",
};
