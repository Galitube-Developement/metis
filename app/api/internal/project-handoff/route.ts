import { getChat } from "@/lib/db-store";
import { getJob, updateJob } from "@/lib/db-jobs";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import { cancelProjectHandoff, createProjectHandoff, stopProjectAgent, manageProjectAgent, ProjectAgentManagementDenied, getProjectAgentForChat, getProjectHandoff, listProjectAgents, syncProjectHandoffStatuses, TEAM_LIMITS } from "@/lib/project-team";
import { bearerTokenMatches } from "@/lib/security";
import { agentRuntimeDeadline, normalizeAgentRuntimeMs } from "@/lib/agent-runtime-policy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
 if (!bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN)) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
 const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
 const ownerId = req.headers.get("x-ai-chat-user-id")?.trim() || "";
 const chat = getChat(chatId, ownerId);
 const parent = getJob(jobId);
 const sender = getProjectAgentForChat(chatId, ownerId);
 if (!ownerId || !chat?.projectId || !sender || sender.archivedAt || parent?.chatId !== chatId || parent.userId !== ownerId) return Response.json({ error: "Invalid sending agent context" }, { status: 403 });
 if (!internalRunLeaseAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
 if (!["running", "queued", "waiting_input", "waiting_for_user"].includes(parent.status)) return Response.json({ error: "Sending agent is no longer active" }, { status: 409 });
 const body = await req.json().catch(() => ({}));
 const projectId = chat.projectId;
 try {
  const action = body.action || "delegate";
  if (action === "create_agent" || action === "update_agent" || action === "archive_agent") {
   const agent = manageProjectAgent({ ownerId, parentJobId: jobId, action, agentId: body.agentId, agent: body.agent });
   return Response.json({ agent });
  }
  if ((action === "stop" || action === "cancel") && typeof body.agentId === "string") {
   const target = listProjectAgents(projectId, ownerId).find(agent => agent.id === body.agentId);
   if (!target || target.archivedAt) return Response.json({ error: "Agent not found" }, { status: 404 });
   let ancestor: ReturnType<typeof getJob> = parent;
   while (ancestor) {
    if (ancestor.chatId === target.chatId) return Response.json({ error: "Cannot stop yourself or a waiting ancestor through team control" }, { status: 409 });
    ancestor = ancestor.parentJobId ? getJob(ancestor.parentJobId) : null;
   }
   return Response.json(stopProjectAgent(projectId, target.id, ownerId));
  }
  if (action === "list") return Response.json({ agents: listProjectAgents(projectId, ownerId), handoffs: syncProjectHandoffStatuses(projectId, ownerId) });
  let handoff;
  let deduplicated = false;
  if (action === "delegate" || action === "retry") {
   const previous = action === "retry" && typeof body.handoffId === "string" ? getProjectHandoff(projectId, body.handoffId, ownerId) : null;
   if (action === "retry" && (!previous || !["error", "cancelled"].includes(previous.status))) throw new Error("Only failed or cancelled handoffs can be retried");
   if (previous && (previous.attempt || 0) >= TEAM_LIMITS.retries) throw new Error("Project handoff retry limit reached");
   const result = createProjectHandoff({ projectId, ownerId, parentJobId: jobId, recipientAgentId: previous?.recipientAgentId || String(body.recipientAgentId || ""), task: previous?.task || String(body.task || ""), context: typeof body.context === "string" ? body.context : previous?.context, timeoutMs: body.timeoutMs, idempotencyKey: body.idempotencyKey, ...(previous ? { retryOf: previous.id } : {}), wait: body.wait !== false });
   handoff = result.handoff; deduplicated = !!result.deduplicated;
  } else if (action === "status" || action === "cancel" || action === "stop") {
   handoff = typeof body.handoffId === "string" ? getProjectHandoff(projectId, body.handoffId, ownerId) : null;
   if (!handoff) return Response.json({ error: "Handoff not found" }, { status: 404 });
   if (action === "cancel" || action === "stop") return Response.json({ handoff: cancelProjectHandoff(projectId, handoff.id, ownerId) });
   return Response.json({ handoff, jobId: handoff.jobId, status: handoff.status, result: handoff.result, error: handoff.error });
  } else throw new Error("Unknown handoff action");
  if (body.wait === false) return Response.json({ handoff, jobId: handoff.jobId, delegated: true, deduplicated });
  // Yield project execution while the provider is inside this synchronous tool.
  // Context and active worker lease were verified above; this is a control update.
  updateJob(jobId, { projectWaitingForHandoffId: handoff.id }, { control: true });
  try {
   const timeoutMs = normalizeAgentRuntimeMs(getJob(handoff.jobId!)?.maxRuntimeMs);
   const deadline = Math.min(agentRuntimeDeadline(Date.now(), timeoutMs), handoff.deadlineAt ? Date.parse(handoff.deadlineAt) : Infinity);
   while (["queued", "running"].includes(handoff.status)) {
    const currentParent = getJob(jobId);
    if (!currentParent || ["cancelled", "error", "interrupted"].includes(currentParent.status)) {
     if (currentParent?.cancellationCause !== "runtime_limit") {
      handoff = cancelProjectHandoff(projectId, handoff.id, ownerId, "Sending agent stopped.") || handoff;
     }
     break;
    }
    if (Date.now() >= deadline) {
     handoff = cancelProjectHandoff(projectId, handoff.id, ownerId, "Handoff timed out.", "runtime_limit") || handoff; break;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    syncProjectHandoffStatuses(projectId, ownerId);
    handoff = getProjectHandoff(projectId, handoff.id, ownerId) || handoff;
   }
   return Response.json({ handoff, jobId: handoff.jobId, delegated: true, deduplicated, status: handoff.status, result: handoff.result, error: handoff.error });
  } finally {
   const current = getJob(jobId);
   if (current && ["running", "waiting_input", "waiting_for_user"].includes(current.status)) updateJob(jobId, { projectWaitingForHandoffId: null }, { control: true });
  }
 } catch (cause) {
  if (cause instanceof ProjectAgentManagementDenied) return Response.json({ error: cause.message }, { status: 403 });
  return Response.json({ error: cause instanceof Error ? cause.message : "Could not assign task" }, { status: 400 });
 }
}
