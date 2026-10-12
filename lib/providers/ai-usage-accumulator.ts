import type { LanguageModelUsage } from "ai";
import type { Usage } from "./adapters/provider-support";

/** Sum SDK aggregate rounds. Missing measurements never become invented zeroes. */
export function createAiUsageAccumulator() {
  const usage: Usage = {};
  const sums: Partial<Record<keyof Usage, number>> = {};
  const reports: Partial<Record<keyof Usage, number>> = {};
  let rounds = 0;
  return {
    usage,
    add(part: LanguageModelUsage) {
      rounds++;
      for (const [key, value] of [
        ["inputTokens", part.inputTokens], ["outputTokens", part.outputTokens],
        ["totalTokens", part.totalTokens],
        ["cachedInputTokens", part.inputTokenDetails?.cacheReadTokens],
        ["cacheWriteInputTokens", part.inputTokenDetails?.cacheWriteTokens],
      ] as const) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          sums[key] = (sums[key] ?? 0) + value;
          reports[key] = (reports[key] ?? 0) + 1;
        }
        if (reports[key] === rounds) usage[key] = sums[key];
        else delete usage[key];
      }
    },
  };
}
