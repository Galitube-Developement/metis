import type { UsageTotals } from "./account-types";

const measured = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export type TokenInput = { input: number | null; cached: number | null; cacheWrite: number | null };
/** Cache reads and writes are disjoint; the provider contract decides input membership. */
export function splitUsageInput(usage: TokenInput, inputIncludesCache?: boolean) {
  const input = measured(usage.input), cached = measured(usage.cached), writes = measured(usage.cacheWrite);
  if (input === null) return { uncached: null, cached, writes, unclassified: null };
  if (inputIncludesCache === false) return { uncached: input, cached, writes, unclassified: 0 };
  if (inputIncludesCache === true) {
    const remainder = input - (cached ?? 0) - (writes ?? 0);
    if (remainder < 0) return { uncached: null, cached, writes, unclassified: null };
    const complete = cached !== null && writes !== null;
    return { uncached: complete ? remainder : null, cached, writes, unclassified: complete ? 0 : remainder };
  }
  // With no contract, reported cache may overlap raw input. Never guess a subtraction.
  return { uncached: null, cached, writes, unclassified: cached === null && writes === null ? input : null };
}

export function usageConsumptionTokens(usage: TokenInput & { output: number | null; total: number | null; processed: number | null }, inputIncludesCache?: boolean) {
  const processed = measured(usage.processed), total = measured(usage.total);
  if (processed !== null) return processed;
  const input = measured(usage.input), output = measured(usage.output);
  const cached = measured(usage.cached), writes = measured(usage.cacheWrite);
  if (inputIncludesCache === false && input !== null && output !== null && cached !== null && writes !== null) {
    const core = input + output;
    // Legacy exclusive-input adapters supplied core as total; include the separate caches once.
    if (total === null || total === core) return core + cached + writes;
  }
  return total ?? (input !== null || output !== null ? (input ?? 0) + (output ?? 0) : null);
}

export const usageTokenOptions = [
  { key: "tokens", label: "All tokens", reports: "tokenReports" },
  { key: "uncachedInputTokens", label: "Input (uncached)", reports: "uncachedInputReports" },
  { key: "cachedInputTokens", label: "Cached input", reports: "cachedInputReports" },
  { key: "cacheWriteInputTokens", label: "Cache write", reports: "cacheWriteInputReports" },
  { key: "outputTokens", label: "Output", reports: "outputReports" },
  { key: "unclassifiedInputTokens", label: "Unclassified input", reports: "unclassifiedInputReports" },
] as const;
export type UsageTokenMetric = typeof usageTokenOptions[number]["key"];
export function usageTokenLabel(metric: UsageTokenMetric) {
  return usageTokenOptions.find(item => item.key === metric)!.label;
}
export function usageTokenReports(value: UsageTotals, metric: UsageTokenMetric) {
  const key = usageTokenOptions.find(item => item.key === metric)!.reports;
  return value[key] ?? 0;
}
export function usageTokenValue(value: UsageTotals, metric: UsageTokenMetric): number | null {
  if (!value.requests) return 0;
  return usageTokenReports(value, metric) ? value[metric] ?? null : null;
}
