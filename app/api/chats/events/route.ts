import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import {
  latestChatSyncEventId,
  listChatSyncEvents,
  subscribeToDatabaseChanges,
} from "@/lib/chat-sync";
import { SSE_HEADERS } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

function requestedCursor(req: Request) {
  const url = new URL(req.url);
  const raw = req.headers.get("Last-Event-ID") || url.searchParams.get("after") || "0";
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const encoder = new TextEncoder();
    let cursor = requestedCursor(req);
    let stopped = false;
    let pendingChange = false;
    let wake: (() => void) | null = null;
    let unsubscribe = () => {};
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown, id?: number) => {
          if (stopped) return;
          try {
            controller.enqueue(encoder.encode(
              `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ));
          } catch {
            stopped = true;
          }
        };
        const notify = () => {
          pendingChange = true;
          const resolve = wake;
          wake = null;
          resolve?.();
        };
        unsubscribe = subscribeToDatabaseChanges(notify);
        const drain = () => {
          let sent = false;
          while (!stopped) {
            const rows = listChatSyncEvents(ownerId, cursor);
            if (!rows.length) break;
            for (const row of rows) {
              cursor = row.id;
              send("chat", {
                chatId: row.chatId,
                kind: row.kind,
                updatedAt: row.chatUpdatedAt,
              }, row.id);
              sent = true;
            }
            if (rows.length < 500) break;
          }
          return sent;
        };

        if (cursor > 0) drain();
        else cursor = latestChatSyncEventId(ownerId);
        send("ready", { cursor }, cursor || undefined);
        controller.enqueue(encoder.encode("retry: 1500\n\n"));

        const deadline = Date.now() + 30 * 60 * 1000;
        while (!stopped && !req.signal.aborted && Date.now() < deadline) {
          if (!pendingChange) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                if (wake === finish) wake = null;
                resolve();
              }, 15_000);
              const finish = () => {
                clearTimeout(timer);
                resolve();
              };
              wake = finish;
              if (pendingChange) finish();
            });
          }
          pendingChange = false;
          const sent = drain();
          if (!sent && !stopped) {
            try { controller.enqueue(encoder.encode(": heartbeat\n\n")); }
            catch { stopped = true; }
          }
        }
        unsubscribe();
        if (!stopped) {
          stopped = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        stopped = true;
        unsubscribe();
        wake?.();
        wake = null;
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    captureApiError("/api/chats/events GET", error, req);
    return Response.json({ error: "Could not open chat sync stream" }, { status: 500 });
  }
}
