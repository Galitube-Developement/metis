import { randomUUID } from "node:crypto";
import { getChat, updateChat, type WorkspaceItem } from "@/lib/db-store";
import { bearerTokenMatches } from "@/lib/security";
import { getIdempotentResponse, saveIdempotentResponse } from "@/lib/shared-context";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceType = "plan" | "canvas";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, service: "workspace" });
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (req.headers.get("x-ai-chat-incognito") === "1") {
    return Response.json({ error: "Workspace tools are unavailable in Incognito." }, { status: 403 });
  }

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (!jobId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!chatId || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });
  if (!internalRunLeaseAuthorized(req, jobId)) {
    return Response.json({ error: "Worker run lease is expired or invalid" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type === "plan" || body.type === "canvas" ? body.type : null;
  const idempotencyKey =
    (typeof body.idempotencyKey === "string" ? body.idempotencyKey : req.headers.get("idempotency-key") || "").trim().slice(0, 200);

  const chat = getChat(chatId, userId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

  const existingId = typeof body.id === "string" ? body.id.trim() : "";
  if (idempotencyKey && body.action !== "list" && body.action !== "get" && body.action !== "open") {
    const existing = getIdempotentResponse<Record<string, unknown>>("workspace", idempotencyKey, userId, chatId);
    if (existing) return Response.json(existing);
  }
  if (body.action === "list") {
    return Response.json({
      workspaces: type ? (chat.workspaces || []).filter((item) => item.type === type) : (chat.workspaces || []),
    });
  }
  if (body.action === "get" || body.action === "open") {
    if (!existingId) return Response.json({ error: "id is required" }, { status: 400 });
    const existing = (chat.workspaces || []).find((item) => item.id === existingId && (!type || item.type === type));
    if (!existing) return Response.json({ error: "Workspace not found" }, { status: 404 });
    return Response.json({ ...existing, workspaceLink: `workspace://${existing.type}/${existing.id}` });
  }
  if (body.action === "delete") {
    if (!existingId) return Response.json({ error: "id is required" }, { status: 400 });
    const existing = (chat.workspaces || []).find((item) => item.id === existingId && (!type || item.type === type));
    if (!existing) return Response.json({ error: "Workspace not found" }, { status: 404 });
    updateChat(chatId, { workspaces: (chat.workspaces || []).filter((item) => item.id !== existingId) }, userId);
    return Response.json({ ok: true, id: existingId });
  }
  if (!type) return Response.json({ error: "type must be plan or canvas" }, { status: 400 });
  if (existingId && (body.action === "edit" || body.action === "update")) {
    const existing = (chat.workspaces || []).find((item) => item.id === existingId && item.type === type);
    if (!existing) return Response.json({ error: "Workspace not found" }, { status: 404 });
    const expectedVersion = typeof body.expectedVersion === "number" ? Math.floor(body.expectedVersion) : undefined;
    if (expectedVersion !== undefined && expectedVersion !== (existing.version || 1)) {
      return Response.json({ error: "Workspace changed by another client", workspace: existing }, { status: 409 });
    }
    const updated: WorkspaceItem = {
      ...existing,
      ...(typeof body.title === "string" ? { name: body.title.trim().slice(0, 200) || existing.name } : {}),
      ...(typeof body.content === "string" ? { content: body.content.slice(0, 100_000) } : {}),
      version: (existing.version || 1) + 1,
      updatedAt: new Date().toISOString(),
    };
    const saved = updateChat(chatId, {
      workspaces: (chat.workspaces || []).map((item) => item.id === existingId ? updated : item),
    }, userId);
    if (!saved?.workspaces?.some((item) => item.id === updated.id && item.version === updated.version)) {
      return Response.json({ error: "Workspace could not be persisted" }, { status: 503 });
    }
    const response = { ...updated, workspaceLink: `workspace://${type}/${updated.id}` };
    if (idempotencyKey) saveIdempotentResponse("workspace", idempotencyKey, response, userId, chatId);
    return Response.json(response);
  }

  const defaultName = type === "plan" ? "Plan" : "Canvas";
  const requestedName = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const content = typeof body.content === "string" ? body.content.slice(0, 100_000) : "";
  const names = new Set(
    (chat.workspaces || [])
      .filter((item) => item.type === type)
      .map((item) => item.name.trim().toLocaleLowerCase()),
  );
  let name = requestedName || defaultName;
  if (names.has(name.toLocaleLowerCase())) {
    let suffix = 2;
    const baseName = name;
    while (names.has(`${baseName} (${suffix})`.toLocaleLowerCase())) suffix += 1;
    name = `${baseName} (${suffix})`.slice(0, 200);
  }

  const timestamp = new Date().toISOString();
  const workspace: WorkspaceItem = {
    id: randomUUID(),
    type,
    name,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    scope: "chat",
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
  const saved = updateChat(
    chatId,
    { workspaces: [...(chat.workspaces || []), workspace].slice(-20) },
    userId,
  );
  if (!saved?.workspaces?.some((item) => item.id === workspace.id)) {
    return Response.json({ error: "Workspace could not be persisted" }, { status: 503 });
  }
  const response = {
    ...workspace,
    workspaceLink: `workspace://${type}/${workspace.id}`,
  };
  if (idempotencyKey) saveIdempotentResponse("workspace", idempotencyKey, response, userId, chatId);
  return Response.json(response);
}
