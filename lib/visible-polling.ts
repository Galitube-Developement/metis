type PollingEnvironment = {
  window: Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
};

/** Refresh visible filesystem views without overlapping requests; dispose aborts stale work. */
export function subscribeVisiblePolling(
  refresh: (signal: AbortSignal) => Promise<void>,
  interval = 2000,
  environment: PollingEnvironment = { window, document },
) {
  let disposed = false;
  let pending: AbortController | undefined;
  const tick = () => {
    if (disposed || pending || environment.document.visibilityState === "hidden") return;
    const controller = new AbortController();
    pending = controller;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return refresh(controller.signal);
    }).catch(() => {
      // The view owns its error state; a failed refresh must not stop subsequent attempts.
    }).finally(() => { if (pending === controller) pending = undefined; });
  };
  const timer = environment.window.setInterval(tick, interval);
  environment.window.addEventListener("focus", tick);
  environment.document.addEventListener("visibilitychange", tick);
  return () => {
    disposed = true;
    pending?.abort();
    environment.window.clearInterval(timer);
    environment.window.removeEventListener("focus", tick);
    environment.document.removeEventListener("visibilitychange", tick);
  };
}
