type RunEvent = { id: number; event: string; data: unknown };
type TerminalEvent = { event: "done" | "error"; data: unknown };

export const RUN_STREAM_BATCH_SIZE = 32;

/** Pull-based SSE: a slow reader retains at most one bounded DB batch.
 * Cancellation/abort releases the polling timer. The DB cursor advances only
 * through emitted events (or explicitly requested snapshot-only deltas).
 */
export function createRunEventStream(options: {
  after: number;
  read: (after: number, limit: number) => RunEvent[];
  terminal: () => TerminalEvent | null;
  snapshotOnly?: boolean;
  signal?: AbortSignal;
  pollMs?: number;
  windowMs?: number;
  heartbeatMs?: number;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor = options.after;
  let stopped = false;
  let batch: RunEvent[] = [];
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const deadline = Date.now() + (options.windowMs ?? 30 * 60 * 1000);
  let lastHeartbeat = Date.now();
  const stop = () => {
    stopped = true;
    batch = [];
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    wake?.();
    wake = undefined;
    options.signal?.removeEventListener("abort", abort);
  };
  const abort = () => {
    if (stopped) return;
    stop();
    controllerRef?.close();
  };
  const encode = (event: string, data: unknown, id?: number) => {
    const payload = id && data && typeof data === "object"
      ? { ...(data as Record<string, unknown>), sequence: id }
      : data;
    return encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    },
    async pull(controller) {
      try {
        while (!stopped) {
          if (Date.now() >= deadline) {
            controller.enqueue(encode("status", { status: "reconnect", message: "Event stream window ended; reconnecting." }));
            stop();
            controller.close();
            return;
          }
          if (offset >= batch.length) {
            batch = options.read(cursor, RUN_STREAM_BATCH_SIZE);
            offset = 0;
            if (!batch.length) {
              // Drain the entire replay backlog before synthesizing completion.
              const terminal = options.terminal();
              if (terminal) {
                // The worker may commit its final events between the empty read
                // and the terminal status read. Recheck after observing status.
                batch = options.read(cursor, RUN_STREAM_BATCH_SIZE);
                offset = 0;
                if (batch.length) continue;
                controller.enqueue(encode(terminal.event, terminal.data));
                stop();
                controller.close();
                return;
              }
              if (Date.now() - lastHeartbeat >= (options.heartbeatMs ?? 15_000)) {
                lastHeartbeat = Date.now();
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
                return;
              }
              await new Promise<void>(resolve => {
                wake = resolve;
                timer = setTimeout(resolve, options.pollMs ?? 500);
              });
              timer = undefined;
              wake = undefined;
              continue;
            }
          }
          const event = batch[offset++];
          cursor = event.id;
          if (options.snapshotOnly && (event.event === "text" || event.event === "thinking")) continue;
          controller.enqueue(encode(event.event, event.data, event.id));
          if (event.event === "done" || event.event === "error") {
            stop();
            controller.close();
          }
          return;
        }
      } catch (error) {
        stop();
        controller.error(error);
      }
    },
    cancel() { stop(); },
  }, { highWaterMark: 0 });
}
