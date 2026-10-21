import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { canAccessChat } from "@/lib/project-access";
import { resolveRecoverySnapshot } from "@/lib/recovery";
import { isSqliteBusyError } from "@/lib/sqlite";
import { createSnapshot, SNAPSHOT_SCHEMA_VERSION } from "@/lib/shared-context";
import type { SessionSnapshot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const chatId = new URL(req.url).searchParams.get("chatId")?.trim() || "";
  if (!chatId) return Response.json({ error: "chatId is required" }, { status: 400 });
  if (!canAccessChat(chatId, userId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  try {
    const snapshot = resolveRecoverySnapshot(chatId, userId);
    return Response.json({
      snapshot,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      status: snapshot?.availability || "not_available",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the session recovery state.";
    return Response.json({ error: message, snapshot: null, status: "not_available" }, { status: isSqliteBusyError(error) ? 503 : 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  if (!chatId || !canAccessChat(chatId, userId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  const sessionState = body.sessionState && typeof body.sessionState === "object" ? body.sessionState as Record<string, unknown> : {};
  const browser = body.browser && typeof body.browser === "object" ? body.browser as Record<string, unknown> : undefined;
  const notesView = body.notesView && typeof body.notesView === "object" ? body.notesView as Record<string, unknown> : undefined;
  try {
    const snapshot = createSnapshot({
    chatId,
    ...(userId ? { ownerId: userId } : {}),
    checkpoint: body.checkpoint === "shutdown" || body.checkpoint === "recovery" || body.checkpoint === "periodic"
      ? body.checkpoint
      : "important",
    activeWorkspaceId: typeof sessionState.activeWorkspaceId === "string" ? sessionState.activeWorkspaceId : null,
    workspaceTab: typeof sessionState.workspaceTab === "string" ? sessionState.workspaceTab as SessionSnapshot["workspaceTab"] : undefined,
    workspaceOpen: sessionState.workspaceOpen === true,
    draft: text(sessionState.input, 100_000),
    filters: sessionState.filters && typeof sessionState.filters === "object" ? sessionState.filters as Record<string, string | boolean | number | null> : undefined,
    runStatus: typeof body.runStatus === "string" ? body.runStatus as SessionSnapshot["runStatus"] : "idle",
    resumeMarker: body.resumeMarker && typeof body.resumeMarker === "object"
      ? {
          jobId: text((body.resumeMarker as Record<string, unknown>).jobId, 200) || undefined,
          runId: text((body.resumeMarker as Record<string, unknown>).runId, 200) || undefined,
          safe: (body.resumeMarker as Record<string, unknown>).safe === true,
          reason: text((body.resumeMarker as Record<string, unknown>).reason, 500) || undefined,
        }
      : undefined,
    browser: browser
      ? {
          tabs: Array.isArray(browser.tabs)
            ? browser.tabs.filter((tab): tab is { id: string; title: string; url: string } =>
                Boolean(tab) && typeof tab === "object" &&
                typeof (tab as { id?: unknown }).id === "string" &&
                typeof (tab as { title?: unknown }).title === "string" &&
                typeof (tab as { url?: unknown }).url === "string",
              ).slice(0, 50).map((tab) => ({
                id: tab.id.slice(0, 200),
                title: tab.title.slice(0, 200),
                url: tab.url.slice(0, 4_000),
              }))
            : [],
          activeTabId: text(browser.activeTabId, 200) || undefined,
          reachable: browser.reachable !== false,
        }
      : undefined,
    terminals: Array.isArray(body.terminals)
      ? body.terminals.filter((terminal): terminal is Record<string, unknown> => Boolean(terminal) && typeof terminal === "object").slice(0, 30).map((terminal) => ({
          id: text(terminal.id, 200),
          sessionId: text(terminal.sessionId, 200) || undefined,
          cwd: text(terminal.cwd, 4_000),
          processId: typeof terminal.processId === "number" ? terminal.processId : undefined,
          lastOutput: text(terminal.lastOutput, 50_000) || undefined,
          exitCode: typeof terminal.exitCode === "number" ? terminal.exitCode : null,
          running: terminal.running === true,
          reachable: terminal.reachable === true,
        })).filter((terminal) => terminal.id && terminal.cwd)
      : undefined,
    notesView: notesView
      ? {
          x: finite(notesView.x, 0),
          y: finite(notesView.y, 0),
          zoom: Math.max(0.1, Math.min(4, finite(notesView.zoom, 1))),
          selectedNoteId: text(notesView.selectedNoteId, 200) || null,
        }
      : undefined,
    availability: "available",
  });
    return Response.json({ snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the session recovery state.";
    return Response.json(
      { error: message },
      { status: isSqliteBusyError(error) ? 503 : 500 },
    );
  }
}
