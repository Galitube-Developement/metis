import {
  getChat,
  normalizeChatKeywords,
  normalizeChatTitle,
  searchChatsForUser,
  updateChat,
} from "@/lib/db-store";
import { bearerTokenMatches } from "@/lib/security";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, service: "chat" });
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });
  if (!internalRunLeaseAuthorized(req, jobId)) {
    return Response.json({ error: "Worker run lease is expired or invalid" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "search" ? "search" : body.action === "title" ? "title" : "update";
  if (action === "search") {
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
    if (!query) return Response.json({ results: [] });
    const requestedLimit = typeof body.limit === "number" ? Math.floor(body.limit) : 10;
    const limit = Math.min(30, Math.max(1, requestedLimit));
    return Response.json({
      results: searchChatsForUser(query, userId, limit),
      actor: "agent",
      jobId,
    });
  }

  if (action === "title") {
    const title = normalizeChatTitle(body.title);
    if (!title) return Response.json({ error: "title must not be empty" }, { status: 400 });
    const agentTitleLocked = chat.agentTitleLocked === true
      || (chat.agentTitleLocked === undefined && chat.titleSource === "user");
    if (agentTitleLocked) {
      return Response.json({
        chatId,
        title: chat.title,
        titleSource: chat.titleSource || "user",
        updated: false,
        skipped: "agent-title-locked",
        actor: "agent",
        jobId,
      });
    }
    const updated = updateChat(chatId, { title, titleSource: "agent" }, userId);
    if (!updated) return Response.json({ error: "Chat not found" }, { status: 404 });
    return Response.json({
      chatId,
      title: updated.title,
      titleSource: updated.titleSource || "agent",
      updated: true,
      actor: "agent",
      jobId,
    });
  }

  const incoming = normalizeChatKeywords(body.keywords);
  if (!incoming.length) return Response.json({ error: "keywords must contain at least one value" }, { status: 400 });
  const mode = body.mode === "replace" ? "replace" : "add";
  const keywords = mode === "replace"
    ? incoming
    : normalizeChatKeywords([...(chat.keywords || []), ...incoming]);
  const updated = updateChat(chatId, { keywords }, userId);
  if (!updated) return Response.json({ error: "Chat not found" }, { status: 404 });
  return Response.json({
    chatId,
    keywords: updated.keywords || [],
    actor: "agent",
    jobId,
  });
}
