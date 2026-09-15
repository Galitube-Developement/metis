export const STREAM_TEXT_BATCH_MS = 64;

export function createStreamTextBatcher(
  flush: (chunk: string) => void,
  delayMs = STREAM_TEXT_BATCH_MS,
) {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const drain = () => {
    timer = null;
    const chunk = pending;
    pending = "";
    if (chunk) flush(chunk);
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      pending += chunk;
      if (timer == null) timer = setTimeout(drain, delayMs);
    },
    flush() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      drain();
    },
    clear() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = "";
    },
    pending() {
      return pending;
    },
  };
}
