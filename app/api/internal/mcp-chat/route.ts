import {
  getChatMetadata,
  normalizeChatKeywords,
  normalizeChatTitle,
  searchChatsForUser,
  updateChat,
} from "@/lib/db-store";
import { bearerTokenMatches } from "@/lib/security";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import { getJob } from "@/lib/db-jobs";
import { ChatProjectError, chatProjectChoices, moveChatToProject } from "@/lib/chat-projects";

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
  if (!jobId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const chat = chatId ? getChatMetadata(chatId, userId) : null;
  if (!chat || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });
  if (!internalRunLeaseAuthorized(req, jobId)) {
    return Response.json({ error: "Worker run lease is expired or invalid" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "projects" || body.action === "move-project") {
    if (!userId) return Response.json({ error: "Authenticated account required" }, { status: 401 });
    const job = getJob(jobId);
    if (!job || job.chatId !== chatId || job.userId !== userId) {
      return Response.json({ error: "Invalid run context" }, { status: 403 });
    }
    if (chat.incognito || job.incognito) {
      return Response.json({ error: "Project tools are unavailable in Incognito." }, { status: 400 });
    }
    if (body.action === "projects") {
      return Response.json({ projects: chatProjectChoices(userId), currentProjectId: chat.projectId || null });
    }
    if (body.projectId !== null && (typeof body.projectId !== "string" || !body.projectId.trim())) {
      return Response.json({ error: "projectId must be an existing project ID or null" }, { status: 400 });
    }
    try {
      const result = moveChatToProject(chatId, typeof body.projectId === "string" ? body.projectId.trim() : null, userId);
      return Response.json({ ...result, actor: "agent", jobId });
    } catch (error) {
      if (error instanceof ChatProjectError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  const action = body.action === "search" ? "search" : body.action === "title" ? "title" : "update";
  if (action === "search") {
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
    if (!query) return Response.json({ results: [] });
    const requestedLimit = typeof body.limit === "number" ? Math.floor(body.limit) : 10;
    const limit = Math.min(30, Math.max(1, requestedLimit));
    return Response.json({
      results: await searchChatsForUser(query, userId, limit),
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
