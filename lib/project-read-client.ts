class ProjectReadError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
export function isProjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function retryDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Only project GETs are retried; permission failures and mutations are never replayed. */
export async function fetchProjectRead<T>(url: string, subject: "project" | "team",
  valid: (body: unknown) => body is T, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      let body: unknown;
      try { body = await response.json(); }
      catch (error) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if ((error as Error)?.name === "AbortError") throw error;
      }
      if (!response.ok) {
        const message = response.status === 401 ? `Your session has expired. Sign in again to load your ${subject}.`
          : response.status === 403 ? `You do not have access to this ${subject}.`
          : response.status === 404 ? "This project could not be found."
          : isProjectRecord(body) && typeof body.error === "string" ? body.error.slice(0, 500)
          : `Could not load your ${subject} (HTTP ${response.status}). Try again.`;
        throw new ProjectReadError(message, response.status >= 500);
      }
      if (!valid(body)) throw new ProjectReadError(`Could not load your ${subject}. The server returned an incomplete response. Try again.`, true);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return body;
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if ((error as Error)?.name === "AbortError") throw error;
      if (error instanceof ProjectReadError && (!error.retryable || attempt === 2)) throw error;
      if (attempt === 2) throw new Error(`Could not reach the server to load your ${subject}. Try again.`);
      await retryDelay(150 * (attempt + 1), signal);
    }
  }
  throw new Error(`Could not load your ${subject}. Try again.`);
}
