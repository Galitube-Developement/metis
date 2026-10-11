import { notifyClientError } from "@/lib/client-error-notifications";

/**
 * Invisible browser telemetry for errors and send-path UX anomalies.
 *
 * Events are batched in memory, deduped for 60s by message/kind, and posted
 * to /api/error-logs. sendBeacon is used as an unload fallback. Reporting is
 * always best-effort and must never affect UI behavior.
 */

export type ClientLogLevel = "error" | "warn" | "info";

export type ClientLogEntry = {
  level: ClientLogLevel;
  source: "frontend";
  chatId?: string;
  sessionLabel?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  ts?: number;
};

type QueuedEntry = ClientLogEntry & { ts: number };

const MAX_QUEUE = 50;
const MAX_MESSAGE_LENGTH = 8_192;
const FLUSH_INTERVAL_MS = 5_000;
const DEDUPE_WINDOW_MS = 60_000;

const state: {
  queue: QueuedEntry[];
  timer: ReturnType<typeof setTimeout> | null;
  sending: boolean;
  seen: Map<string, number>;
  installed: boolean;
  originalConsoleError: typeof console.error | null;
} = {
  queue: [],
  timer: null,
  sending: false,
  seen: new Map(),
  installed: false,
  originalConsoleError: null,
};

let activeChatId: string | undefined;
let activeSessionLabel: string | undefined;

function browserContext(): Record<string, unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    userAgent: window.navigator?.userAgent,
    url: window.location.href,
    route: window.location.pathname,
  };
}

function scheduleFlush() {
  if (state.timer || typeof setTimeout === "undefined" || typeof window === "undefined") return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushClientTelemetry();
  }, FLUSH_INTERVAL_MS);
}

function enqueue(entry: ClientLogEntry) {
  const detail = entry.context?.detail;
  const detailKey = detail && typeof detail === "object"
    ? (detail as { reason?: unknown }).reason
    : undefined;
  const key = `${entry.level}:${entry.message.slice(0, 300)}:${String(detailKey ?? "")}`;
  const now = Date.now();
  const last = state.seen.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return;
  state.seen.set(key, now);
  if (state.seen.size > 200) {
    for (const [seenKey, seenAt] of state.seen) {
      if (now - seenAt >= DEDUPE_WINDOW_MS) state.seen.delete(seenKey);
    }
  }
  if (state.queue.length >= MAX_QUEUE) state.queue.shift();
  state.queue.push({
    ...entry,
    message: entry.message.slice(0, MAX_MESSAGE_LENGTH),
    ts: now,
  });
  scheduleFlush();
}

async function flushClientTelemetry() {
  if (state.sending || typeof window === "undefined" || !state.queue.length)
    return;
  const entries = state.queue.splice(0, MAX_QUEUE);
  state.sending = true;
  try {
    const response = await fetch("/api/error-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
      keepalive: true,
    });
    if (!response.ok)
      state.queue.unshift(...entries.slice(0, MAX_QUEUE - state.queue.length));
  } catch {
    // Telemetry must never surface as a user-facing error.
  } finally {
    state.sending = false;
    if (state.queue.length) scheduleFlush();
  }
}

/** Report a caught browser error / unhandled rejection. */
export function reportClientError(
  message: string,
  options: {
    stack?: string;
    level?: ClientLogLevel;
    context?: Record<string, unknown>;
  } = {},
) {
  enqueue({
    level: options.level ?? "error",
    source: "frontend",
    chatId: activeChatId,
    sessionLabel: activeSessionLabel,
    message,
    stack: options.stack,
    context: { ...(browserContext() ?? {}), ...(options.context ?? {}) },
  });
}

/** Report an invisible UX event (send-path anomaly, composer race, etc). */
export function reportUxEvent(
  kind: string,
  detail: Record<string, unknown> = {},
) {
  enqueue({
    level: "info",
    source: "frontend",
    chatId: activeChatId,
    sessionLabel: activeSessionLabel,
    message: `ux:${kind}`,
    context: { ...(browserContext() ?? {}), kind, detail },
  });
}

export function setTelemetrySession(chatId?: string, sessionLabel?: string) {
  activeChatId = chatId;
  activeSessionLabel = sessionLabel;
}

export function flushTelemetryOnUnload() {
  if (typeof window === "undefined" || !state.queue.length) return;
  const entries = state.queue.splice(0, MAX_QUEUE);
  try {
    navigator.sendBeacon?.(
      "/api/error-logs",
      new Blob([JSON.stringify({ entries })], { type: "application/json" }),
    );
  } catch {
    // Best effort only.
  }
}

/** Install global browser handlers. Idempotent. */
export function installGlobalClientTelemetry() {
  if (state.installed || typeof window === "undefined") return;
  state.installed = true;

  window.addEventListener("error", (event) => {
    notifyClientError(event.message || "An unexpected browser error occurred.");
    reportClientError(event.message || "Uncaught browser error", {
      stack: event.error instanceof Error ? event.error.stack : undefined,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    notifyClientError(reason);
    reportClientError(
      reason instanceof Error
        ? reason.message
        : `Unhandled rejection: ${String(reason)}`,
      { stack: reason instanceof Error ? reason.stack : undefined },
    );
  });
  window.addEventListener("pagehide", flushTelemetryOnUnload);

  const original = console.error.bind(console);
  state.originalConsoleError = original;
  console.error = (...args: unknown[]) => {
    try {
      reportClientError(
        args
          .map((arg) =>
            arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg),
          )
          .join(" "),
        { level: "error" },
      );
    } catch {
      // Interceptor itself must never throw.
    }
    original(...args);
  };
}

/** Test helper: clear dedupe state and force-return the current queue. */
export function __resetClientTelemetryForTests() {
  state.queue = [];
  state.seen.clear();
  state.sending = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

export function __queuedClientTelemetryForTests() {
  return [...state.queue];
}
