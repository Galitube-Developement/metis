import { readCodexThreadRolloutTail } from "./codex-context";

export type CodexUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
};
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Native totals include cached input; reasoning output is already part of output. */
export function codexUsageTotals(value: unknown): CodexUsageTotals | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!count(record.input_tokens) || !count(record.output_tokens)) return undefined;
  return {
    inputTokens: record.input_tokens, outputTokens: record.output_tokens,
    ...(count(record.cached_input_tokens) ? { cachedInputTokens: record.cached_input_tokens } : {}),
    ...(count(record.cache_write_input_tokens) ? { cacheWriteInputTokens: record.cache_write_input_tokens } : {}),
  };
}

export function codexUsageFromRollout(tail: string): CodexUsageTotals | undefined {
  for (const line of tail.split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type !== "event_msg" || event.payload?.type !== "token_count") continue;
      const usage = codexUsageTotals(event.payload.info?.total_token_usage);
      if (usage) return usage;
    } catch { /* Bounded tails may start or end with a partial line. */ }
  }
  return undefined;
}

export function readCodexThreadUsage(home: string, threadId: string): CodexUsageTotals | undefined {
  const tail = readCodexThreadRolloutTail(home, threadId);
  return tail === undefined ? undefined : codexUsageFromRollout(tail);
}

export function codexUsageDelta(current: CodexUsageTotals, baseline: CodexUsageTotals): CodexUsageTotals | undefined {
  const inputTokens = current.inputTokens - baseline.inputTokens;
  const outputTokens = current.outputTokens - baseline.outputTokens;
  if (!count(inputTokens) || !count(outputTokens)) return undefined;
  const delta: CodexUsageTotals = { inputTokens, outputTokens };
  for (const key of ["cachedInputTokens", "cacheWriteInputTokens"] as const) {
    if (current[key] === undefined || baseline[key] === undefined) continue;
    const value = current[key]! - baseline[key]!;
    if (!count(value)) return undefined;
    delta[key] = value;
  }
  return delta;
}

const equalCore = (a: CodexUsageTotals, b: CodexUsageTotals) =>
  a.inputTokens === b.inputTokens && a.outputTokens === b.outputTokens;

/** SDK versions can emit thread totals or turn totals. Native counters disambiguate them. */
export function codexTurnUsage(
  reported: CodexUsageTotals,
  baseline: CodexUsageTotals | undefined,
  nativeCurrent: CodexUsageTotals | undefined,
  resumed: boolean,
): CodexUsageTotals | undefined {
  if (!resumed) return nativeCurrent && !equalCore(nativeCurrent, reported) ? undefined : reported;
  if (!baseline) return undefined; // Never charge an unknown resumed session's lifetime.
  if (nativeCurrent) {
    const delta = codexUsageDelta(nativeCurrent, baseline);
    if (!delta) return undefined;
    if (equalCore(nativeCurrent, reported)) return delta;
    if (equalCore(delta, reported)) return reported;
    return undefined;
  }
  return codexUsageDelta(reported, baseline);
}

export type CodexCompletedUsage = {
  completedAt: string;
  cumulative: CodexUsageTotals;
  usage: CodexUsageTotals;
};

/** Stream this exact native thread for repair; task boundaries exclude older/aborted turns. */
export async function codexCompletedUsage(lines: AsyncIterable<string>): Promise<CodexCompletedUsage[]> {
  let current: CodexUsageTotals | undefined;
  let baseline: CodexUsageTotals | undefined;
  let inTurn = false;
  let sawSessionStart = false;
  const turns: CodexCompletedUsage[] = [];
  for await (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "session_meta") sawSessionStart = true;
      if (event.type !== "event_msg") continue;
      const payload = event.payload;
      if (payload?.type === "task_started") {
        baseline = current || (sawSessionStart ? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 } : undefined);
        inTurn = true;
      } else if (payload?.type === "token_count") {
        current = codexUsageTotals(payload.info?.total_token_usage) || current;
      } else if (payload?.type === "task_complete") {
        const usage = current && baseline && codexUsageDelta(current, baseline);
        if (inTurn && current && usage && typeof event.timestamp === "string" && Number.isFinite(Date.parse(event.timestamp))) {
          turns.push({ completedAt: event.timestamp, cumulative: current, usage });
        }
        inTurn = false;
      } else if (payload?.type === "turn_aborted") {
        inTurn = false;
      }
    } catch { /* Ignore incomplete or unrelated lines; never inspect message content. */ }
  }
  return turns;
}
