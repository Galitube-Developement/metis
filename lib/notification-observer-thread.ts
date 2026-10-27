import { Worker } from "node:worker_threads";
import { config } from "./config";
import { notificationDatabase, type NotificationRecord } from "./notification-store";

type Send = (clientId: string, ownerId: string, notification: NotificationRecord) => Promise<boolean>;
type Options = {
  send?: Send;
  intervalMs?: number;
  restartMs?: number;
  stopTimeoutMs?: number;
  onReady?: () => void;
  onError?: (message: string) => void;
};

/** One worker, one serial poll, at most the existing delivery batch (32) in flight. */
export function startNotificationObserver(options: Options = {}) {
  // Establish the first-install cursor before accepting requests or new events.
  notificationDatabase();
  let worker: Worker | undefined;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let inFlight = 0;
  let stopping: Promise<void> | undefined;
  const report = options.onError ?? ((message: string) => console.warn("[notifications] Observer failed", message));
  const send: Send = options.send ?? (async (...args) => {
    const { sendRemoteNotification } = await import("./notification-remote");
    return sendRemoteNotification(...args);
  });
  function launch() {
    if (stopped) return;
    const current = new Worker(new URL("./notification-observer-worker.mjs", import.meta.url), {
      workerData: { databasePath: config.databasePath, intervalMs: options.intervalMs ?? 1000 },
      execArgv: [],
    });
    worker = current;
    current.unref();
    current.on("message", message => {
      if (stopped || worker !== current) return;
      if (message.type === "ready") options.onReady?.();
      else if (message.type === "warning") report(message.error);
      else if (message.type === "send") {
        if (inFlight >= 32) {
          current.postMessage({ type: "result", id: message.id, acknowledged: false });
          return;
        }
        inFlight++;
        void Promise.resolve().then(() => send(message.clientId, message.ownerId, message.notification))
          .catch(() => false).then(acknowledged => {
            inFlight--;
            if (!stopped && worker === current)
              current.postMessage({ type: "result", id: message.id, acknowledged });
          });
      }
    });
    current.on("error", error => report(error.message));
    current.on("exit", code => {
      if (worker === current) worker = undefined;
      if (!stopped) {
        report(`Worker exited (${code}); restarting`);
        restart = setTimeout(launch, options.restartMs ?? 1000);
        restart.unref();
      }
    });
  }
  launch();
  return function stop(): Promise<void> {
    if (stopping) return stopping;
    stopped = true;
    clearTimeout(restart);
    const current = worker;
    if (!current) return stopping = Promise.resolve();
    current.ref();
    stopping = new Promise(resolve => {
      const deadline = setTimeout(() => { void current.terminate(); }, options.stopTimeoutMs ?? 1500);
      deadline.unref();
      current.once("exit", () => { clearTimeout(deadline); resolve(); });
      current.postMessage({ type: "stop" });
    });
    return stopping;
  };
}
