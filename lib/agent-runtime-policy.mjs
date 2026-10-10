export const DEFAULT_AGENT_RUNTIME_MS = 30 * 60_000;
export const MAX_AGENT_RUNTIME_MS = 6 * 60 * 60_000;

/** One persisted runtime policy for delegated and project agent jobs. */
export function normalizeAgentRuntimeMs(value) {
  const requested = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value) : DEFAULT_AGENT_RUNTIME_MS;
  return Math.min(MAX_AGENT_RUNTIME_MS, Math.max(1_000, requested));
}

export const AGENT_RUNTIME_SCHEMA = {
  type: "integer", minimum: 1_000, maximum: MAX_AGENT_RUNTIME_MS,
  default: DEFAULT_AGENT_RUNTIME_MS,
  description: "Run limit in milliseconds, including synchronous result waiting. Defaults to 30 minutes; maximum 6 hours. Also enforced for wait=false.",
};
