import { getAuthenticatedUserId } from "@/lib/auth";
import { getChat } from "@/lib/db-store";
import { getRemoteClient, authorizeRemoteAction } from "@/lib/remote-clients";
import { matchesDesktopEvent, remoteDesktopEvents, type RemoteDesktopEvent } from "@/lib/remote-desktop-events";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const chatId = new URL(req.url).searchParams.get("chatId")?.trim();
  if (!chatId || !getChat(chatId, ownerId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  const encoder = new TextEncoder();
  let listener: ((event: RemoteDesktopEvent) => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let abort: (() => void) | null = null;
  const cleanup = () => {
    if (listener) remoteDesktopEvents.off("activity", listener);
    if (timer) clearInterval(timer);
    if (abort) req.signal.removeEventListener("abort", abort);
    listener = null; timer = null; abort = null;
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => { try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); } };
      listener = event => {
        if (!matchesDesktopEvent(event, ownerId, chatId)) return;
        const client = getRemoteClient(event.clientId, ownerId);
        if (!client || !authorizeRemoteAction(client, "computer_use").allowed) return;
        // Account identifiers and raw commands never leave the server.
        send("data: " + JSON.stringify({ clientId: event.clientId, action: event.action, phase: event.phase, timestamp: event.timestamp }) + "\n\n");
      };
      remoteDesktopEvents.on("activity", listener);
      send("retry: 3000\n\n");
      timer = setInterval(() => send(": ping\n\n"), 15_000);
      abort = () => { cleanup(); try { controller.close(); } catch { /* Already closed. */ } };
      if (req.signal.aborted) abort();
      else req.signal.addEventListener("abort", abort, { once: true });
    },
    cancel: cleanup,
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
