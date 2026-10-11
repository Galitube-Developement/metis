import { toast } from "sonner";

type ErrorToastOptions = {
  title?: string;
  key?: string;
  occurredAt?: number;
  action?: { label: string; onClick: () => void };
};
type ErrorToast = { id: string; description: string; duration: number; action?: ErrorToastOptions["action"] };

/** Share deduplication between live errors and the delayed notification feed. */
export function createErrorNotifier(deliver: (title: string, options: ErrorToast) => void, now = Date.now) {
  const seen = new Map<string, { shownAt: number; occurredAt: number; message: string }>();
  return (error: unknown, options: ErrorToastOptions = {}) => {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return false;
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const message = raw.trim().slice(0, 500) || "An unexpected error occurred. Please try again.";
    const title = options.title || "Something went wrong";
    const key = options.key || `client-error:${title}:${message}`;
    const timestamp = now();
    const previous = seen.get(key);
    if (previous && (
      options.occurredAt !== undefined && Number.isFinite(options.occurredAt)
        ? options.occurredAt <= previous.occurredAt
        : timestamp - previous.shownAt < 10_000 && previous.message === message
    )) return false;
    seen.set(key, { shownAt: timestamp, occurredAt: options.occurredAt ?? timestamp, message });
    if (seen.size > 200) seen.delete(seen.keys().next().value!);
    deliver(title, { id: key, description: message, duration: 8000, action: options.action });
    return true;
  };
}

export const notifyClientError = createErrorNotifier((title, options) => { toast.error(title, options); });
