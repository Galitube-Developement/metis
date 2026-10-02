import { setTimeout as delay } from "node:timers/promises";
import { iterateUntilAborted } from "@/lib/providers/stream-guard";

type CodexEvent = { type: string; message?: string; error?: { message: string } };

/** Retry only a rejected native resume before it can emit output or execute tools. */
export async function* codexEventsWithResumeRetry<T extends CodexEvent>(
  start: () => Promise<AsyncIterable<T>>,
  options: { resume: boolean; signal?: AbortSignal; timeoutMs?: number; retryMs?: number },
): AsyncGenerator<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  let started = false;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      const events = await start();
      for await (const event of iterateUntilAborted(events, options.signal)) {
        const failure = event.type === "error" ? event.message
          : event.type === "turn.failed" ? event.error?.message : undefined;
        if (failure && isWriterConflict(failure)) throw new Error(failure);
        // Once the thread starts, replaying this prompt could duplicate actions.
        started = true;
        yield event;
      }
      return;
    } catch (error) {
      if (!options.resume || started || options.signal?.aborted ||
          !isWriterConflict(error instanceof Error ? error.message : String(error)) ||
          Date.now() >= deadline) throw error;
      await delay(Math.min(options.retryMs ?? 250, deadline - Date.now()), undefined, {
        signal: options.signal,
      });
    }
  }
}

function isWriterConflict(message: string) {
  return /thread(?:-store conflict|\/resume)[\s\S]*already has an active writer/i.test(message);
}
