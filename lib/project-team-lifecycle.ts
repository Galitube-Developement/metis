import { getDatabase, parseData } from "@/lib/sqlite";
import { appendMessage, getChat, updateChat } from "@/lib/db-store";
import { resolveApproval } from "@/lib/db-approvals";
import { cancelQuestion } from "@/lib/db-questions";
import type { AgentJob } from "@/lib/jobs";
import type { ProjectHandoff } from "@/lib/project-team-types";

/** Runs inside the job's write transaction, including failures and cancellation. */
export function syncHandoffForJob(job: AgentJob) {
 const db = getDatabase();
 if (job.projectTeamId && ["cancelled", "error", "interrupted"].includes(job.status)) {
  for (const row of db.prepare("SELECT id FROM pending_approvals WHERE job_id = ? AND owner_id = ? AND status = 'waiting_for_user'").all(job.id, job.userId ?? "") as { id: string }[]) resolveApproval(row.id, "deny", job.userId);
  for (const row of db.prepare("SELECT question_id AS id FROM pending_questions WHERE json_extract(data, '$.jobId') = ? AND user_id = ? AND status = 'waiting_for_user'").all(job.id, job.userId ?? "") as { id: string }[]) cancelQuestion(row.id, job.userId);
  updateChat(job.chatId, { runStatus: job.status === "cancelled" ? "cancelled" : job.status === "error" ? "error" : "interrupted", runUpdatedAt: job.updatedAt, pendingApproval: null, pendingQuestion: null }, job.userId);
 }
 if (!job.projectHandoffId) return;
 const h = parseData<ProjectHandoff>(db.prepare("SELECT data FROM project_handoffs WHERE id = ? AND owner_id = ?").get(job.projectHandoffId, job.userId ?? ""));
 if (!h || h.jobId !== job.id) return;
 const status = job.status === "completed" ? "completed" : job.status === "cancelled" ? "cancelled" : ["error", "interrupted"].includes(job.status) ? "error" : job.status === "queued" ? "queued" : "running";
 const terminal = ["completed", "cancelled", "error"].includes(status);
 const chat = getChat(job.chatId, job.userId);
 const start = chat?.messages.findIndex(m => m.id === job.messageId) ?? -1;
 const messages = start >= 0 ? chat!.messages.slice(start + 1) : [];
 const result = [...messages].reverse().find(m => m.role === "assistant" && !m.id.startsWith("handoff:"))?.content;
 const next: ProjectHandoff = {
  ...h, status, updatedAt: job.updatedAt,
  ...(status === "running" && !h.startedAt ? { startedAt: new Date().toISOString() } : {}),
  ...(terminal ? { completedAt: h.completedAt || job.updatedAt, result: status === "completed" ? result || "" : undefined, error: status === "completed" ? undefined : job.error || "Run interrupted." } : {}),
 };
 db.prepare("UPDATE project_handoffs SET data = ?, status = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), next.status, next.updatedAt, h.id);
 // Child worker leases cannot write into the sender chat. The API poll reconciles
 // these deterministic mirrors after that lease ends; reportedAt is not a skip guard.
 if (!terminal) return;
 const sender = h.senderAgentId ? db.prepare("SELECT chat_id AS chatId FROM project_agents WHERE id = ? AND project_id = ? AND owner_id = ?").get(h.senderAgentId, h.projectId, job.userId ?? "") as { chatId: string } | undefined : undefined;
 const text = `Handoff ${h.id} · ${h.senderName || "You"} → ${h.recipientName || "Agent"} · ${status}\n\nTask: ${h.task}\n\n${next.error ? "Error: " + next.error : "Result: " + (next.result || "(No result returned)")}`;
 // Mirrors are assistant messages, never queued requests; deterministic IDs make retries idempotent.
 if (sender) appendMessage(sender.chatId, { id: `handoff:${h.id}:result:sender`, role: "assistant", content: text }, job.userId);
 if (status !== "completed") appendMessage(job.chatId, { id: `handoff:${h.id}:result:recipient`, role: "assistant", content: text }, job.userId);
 next.reportedAt = h.reportedAt || new Date().toISOString();
 db.prepare("UPDATE project_handoffs SET data = ? WHERE id = ?").run(JSON.stringify(next), h.id);
}
