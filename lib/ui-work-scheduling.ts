/** Skip polling/replay snapshots that have already been applied to the active view. */
export function shouldApplySnapshotVersion(previous: string | undefined, incoming: string | undefined, skipUnchanged = false): boolean {
  return !incoming || !previous || (skipUnchanged ? incoming > previous : incoming >= previous);
}

/** Debounce optional cache work, then yield to interaction and paint when supported. */
export function scheduleUiBackgroundTask(task: () => void, delayMs = 250): () => void {
  let cancelled = false;
  let idle: number | undefined;
  const timer = setTimeout(() => {
    if (cancelled) return;
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(() => { if (!cancelled) task(); }, { timeout: 1000 });
    } else if (!cancelled) {
      task();
    }
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    if (idle !== undefined && typeof window !== "undefined") window.cancelIdleCallback?.(idle);
  };
}
