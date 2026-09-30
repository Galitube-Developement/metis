/**
 * Item-buffered SDKs do not expose token deltas while generating long messages
 * or tool arguments. Keep a finite silence limit without treating that normal
 * generation time as the shorter timeout used by token-streaming providers.
 */
export function providerIdleTimeouts(
  progressDelivery: "buffered" | "continuous" | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const duration = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return value?.trim() && Number.isFinite(parsed) && parsed > 0
      ? Math.max(60_000, parsed)
      : fallback;
  };
  // The existing global override remains authoritative for both stream types.
  const defaultIdleMs = duration(env.AI_CHAT_PROVIDER_IDLE_MS, 3 * 60_000);
  const providerIdleMs = progressDelivery === "buffered"
    ? duration(
        env.AI_CHAT_PROVIDER_BUFFERED_IDLE_MS ?? env.AI_CHAT_PROVIDER_IDLE_MS,
        15 * 60_000,
      )
    : defaultIdleMs;
  const providerToolIdleMs = Math.max(
    providerIdleMs,
    duration(env.AI_CHAT_PROVIDER_TOOL_IDLE_MS, 30 * 60_000),
  );
  return { providerIdleMs, providerToolIdleMs };
}

const IN_FLIGHT_TOOL_STATUSES = new Set([
  "running",
  "in_progress",
  "pending",
  "started",
  "executing",
  "queued",
]);

export function isInFlightToolStatus(status: unknown) {
  return IN_FLIGHT_TOOL_STATUSES.has(String(status || "").trim().toLowerCase());
}

/**
 * Only the newest still-running tool may extend the long stall window.
 * Earlier zombie "running" rows after a later completed tool/text must not
 * keep a Codex/OpenAI turn alive forever.
 */
export function activeInFlightTool<T extends { status?: unknown }>(
  tools: readonly T[],
): T | undefined {
  const lastTerminal = tools.findLastIndex(
    (tool) => !isInFlightToolStatus(tool.status),
  );
  for (let index = tools.length - 1; index > lastTerminal; index -= 1) {
    const tool = tools[index];
    if (tool && isInFlightToolStatus(tool.status)) return tool;
  }
  return undefined;
}

export function abortError(message = "Provider run aborted.") {
  return Object.assign(new Error(message), { name: "AbortError" });
}

/**
 * Codex/OpenAI streams can stay open after the last visible token.
 * AbortSignal on spawn is not enough: if the child ignores SIGTERM, the
 * async iterator never completes. Race the iterator against abort so the
 * worker can emit done/error instead of hanging the chat.
 */
export async function* iterateUntilAborted<T>(
  iterable: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const fail = () => rejectAbort?.(abortError());
  if (signal?.aborted) fail();
  signal?.addEventListener("abort", fail, { once: true });
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    signal?.removeEventListener("abort", fail);
    try {
      await iterator.return?.();
    } catch {
      // Producer may already be torn down by abort.
    }
  }
}
