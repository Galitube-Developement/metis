import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { contextWindowOf } from "@/lib/context-window";

export function codexSessionHome(dataDir: string, ownerId: string, connectionId: string) {
  return path.join(dataDir, "provider-sessions", "codex", ownerId, connectionId);
}

/** The CLI cache is account-specific provider metadata, never a family guess. */
export function codexCachedContextWindow(home: string, modelId: string): number | undefined {
  try {
    const cache = JSON.parse(readFileSync(path.join(home, "models_cache.json"), "utf8"));
    if (!Array.isArray(cache.models)) return undefined;
    const model = cache.models.find((entry: { slug?: string; id?: string; model?: string }) =>
      (entry.slug || entry.model || entry.id) === modelId,
    );
    return contextWindowOf(model);
  } catch {
    return undefined;
  }
}

export type CodexThreadContext = { usedTokens: number; maxTokens?: number };

/** Only last_token_usage describes the current context; totals accumulate across calls. */
export function codexContextFromRollout(tail: string): CodexThreadContext | undefined {
  for (const line of tail.split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type !== "event_msg" || event.payload?.type !== "token_count") continue;
      const info = event.payload.info;
      const used = info?.last_token_usage?.total_tokens;
      if (typeof used !== "number" || !Number.isFinite(used) || used < 0) continue;
      const maxTokens = contextWindowOf(info);
      return { usedTokens: used, ...(maxTokens ? { maxTokens } : {}) };
    } catch {
      // A bounded tail can begin mid-line or end at an in-progress write.
    }
  }
  return undefined;
}

/** Read at most 1 MiB of the exact thread's native rollout, without loading chat content. */
export function readCodexThreadContext(home: string, threadId: string): CodexThreadContext | undefined {
  if (!/^[a-f0-9-]{36}$/i.test(threadId)) return undefined;
  let fd: number | undefined;
  try {
    const root = path.join(home, "sessions");
    const file = readdirSync(root, { recursive: true, encoding: "utf8" })
      .find((entry) => path.basename(entry).endsWith(`-${threadId}.jsonl`));
    if (!file) return undefined;
    const filename = path.join(root, file);
    const size = statSync(filename).size;
    const length = Math.min(size, 1024 * 1024);
    const buffer = Buffer.alloc(length);
    fd = openSync(filename, "r");
    const bytesRead = readSync(fd, buffer, 0, length, size - length);
    return codexContextFromRollout(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
