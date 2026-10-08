import type { ChatRunStatus } from "@/lib/store";
import { createHash, randomUUID } from "node:crypto";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import { createChat, appendMessage, getChat, getGlobalModelSettings, updateChat } from "@/lib/db-store";
import { cancelChildJobs, enqueueJob, getJob, requestJobCancel, updateJob } from "@/lib/db-jobs";
import { isModelAllowed } from "@/lib/model-access";
import { findActiveConnection, getProviderConnection, listProviderModels } from "@/lib/provider-connections";
import { parseModelKey } from "@/lib/providers/types";
import { providerModelIdsMatch } from "@/lib/providers/model-aliases";
import { getProject } from "@/lib/projects";
import { syncHandoffForJob } from "@/lib/project-team-lifecycle";
import { deriveProjectAgentStatus } from "@/lib/project-team-types";
import { parseWorkerConcurrency } from "@/lib/worker-scheduler";
import type { ProjectAgent, ProjectHandoff } from "@/lib/project-team-types";
import type { AgentJob } from "@/lib/jobs";

const iso = () => new Date().toISOString();
export const TEAM_LIMITS = { agents: 32, depth: 4, perParent: 8, perRoot: 32, retries: 3, timeoutMs: 30 * 60_000 } as const;
const ACTIVE = new Set(["queued", "running", "switching", "waiting_input", "waiting_for_user"]);
const clip = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const ownerRequired = (ownerId?: string) => { if (!ownerId) throw new Error("Authenticated account required"); return ownerId; };

export const AGENT_PRESETS = [
 { name: "Coordinator", role: "Organizes the team and reports verified results", color: "#1767ed", systemPrompt: "Coordinate work autonomously within the user's request. For implementation tasks, assign the Planner first, pass its concrete plan to the Software Engineer, and assign the Tester to verify the result. Organize corrections when the Tester finds issues. Use project_handoff for real assignments; await actual results. Report a concise summary and evidence, never claim consultation without a successful handoff." },
 { name: "Planner", role: "Turns requests into concrete implementation plans", color: "#7324d6", systemPrompt: "Inspect relevant code and constraints. Return a concrete plan with file boundaries, risks, and acceptance checks for the Coordinator. Do not implement changes unless specifically assigned." },
 { name: "Software Engineer", role: "Implements and checks the assigned changes", color: "#079e6c", systemPrompt: "Implement the assigned work using the existing architecture and project instructions. Preserve unrelated changes, run focused checks, and return changed files, actual command evidence, and limitations." },
 { name: "Tester", role: "Verifies behavior and reports actionable findings", color: "#f87916", systemPrompt: "Verify the assigned implementation through meaningful tests and real behavior. Report exact commands, observed results, defects, and unverified limitations. Do not claim success from another agent's summary alone." },
] as const;

function ownedProject(projectId: string, ownerId?: string) {
 ownerRequired(ownerId);
 const project = getProject(projectId, ownerId);
 if (!project || project.ownerId !== ownerId) throw new Error("Project not found");
 if (project.mode !== "agents") throw new Error("This project uses regular chats");
 return project;
}
function rowAgent(row: unknown, ownerId: string): ProjectAgent | null {
 const value = parseData<ProjectAgent>(row);
 if (!value?.id) return null;
 const chat = getDatabase().prepare("SELECT run_status AS runStatus FROM chat_list WHERE id = ? AND owner_id = ?").get(value.chatId, ownerId) as { runStatus?: ChatRunStatus } | undefined;
 const active = getDatabase().prepare("SELECT status FROM jobs WHERE chat_id = ? AND user_id = ? AND status IN ('queued','running','switching','waiting_input','waiting_for_user') LIMIT 1").get(value.chatId, ownerId) as { status: string } | undefined;
 return { ...value, status: value.archivedAt ? "archived" : active?.status === "queued" ? "queued" : deriveProjectAgentStatus(chat?.runStatus, value.archivedAt) };
}
export function getProjectAgent(projectId: string, agentId: string, ownerId?: string) {
 if (!ownerId || !getProject(projectId, ownerId)) return null;
 return rowAgent(getDatabase().prepare("SELECT data FROM project_agents WHERE id = ? AND project_id = ? AND owner_id = ?").get(agentId, projectId, ownerId), ownerId);
}
export function getProjectAgentForChat(chatId: string, ownerId?: string) {
 if (!ownerId) return null;
 const row = getDatabase().prepare("SELECT data FROM project_agents WHERE chat_id = ? AND owner_id = ?").get(chatId, ownerId);
 return rowAgent(row, ownerId);
}
export function listProjectAgents(projectId: string, ownerId?: string) {
 if (!ownerId || !getProject(projectId, ownerId)) return [];
 return getDatabase().prepare("SELECT data FROM project_agents WHERE project_id = ? AND owner_id = ? ORDER BY created_at, rowid").all(projectId, ownerId).map(row => rowAgent(row, ownerId)).filter((a): a is ProjectAgent => !!a);
}
export function validateProjectModelSelection(ownerId: string, modelId?: string) {
 if (!modelId) return;
 const selected = parseModelKey(modelId);
 const connection = selected.connectionId ? getProviderConnection(selected.connectionId, ownerId) : findActiveConnection(ownerId, selected.providerKey);
 if (!connection?.enabled || !listProviderModels(connection.id).some(m => providerModelIdsMatch(selected.providerKey, m.id, selected.modelId))) throw new Error("This model has not been discovered. Refresh models in Settings.");
 if (!isModelAllowed(ownerId, modelId)) throw new Error("This model is not available for your account");
}
function validateSupervisor(projectId: string, id: string, supervisorId: string | undefined, ownerId: string) {
 if (!supervisorId) return;
 const seen = new Set([id]);
 let current: string | undefined = supervisorId;
 while (current) {
  if (seen.has(current)) throw new Error("Supervising agents cannot form a cycle");
  seen.add(current);
  const agent = getProjectAgent(projectId, current, ownerId);
  if (!agent || agent.archivedAt) throw new Error("Supervising agent must belong to this project");
  current = agent.supervisorId;
 }
}
export function createProjectAgent(input: { projectId: string; ownerId?: string; name?: string; role?: string; systemPrompt?: string; color?: string; modelId?: string; supervisorId?: string }) {
 return transaction(() => {
  const ownerId = ownerRequired(input.ownerId);
  ownedProject(input.projectId, ownerId);
  if (listProjectAgents(input.projectId, ownerId).filter(a => !a.archivedAt).length >= TEAM_LIMITS.agents) throw new Error("Project agent limit reached");
  const name = clip(input.name, 120), role = clip(input.role, 120);
  if (!name || !role) throw new Error("Agent name and role are required");
  const modelId = clip(input.modelId, 300) || undefined;
  validateProjectModelSelection(ownerId, modelId);
  const id = randomUUID(), timestamp = iso(), supervisorId = clip(input.supervisorId, 120) || undefined;
  validateSupervisor(input.projectId, id, supervisorId, ownerId);
  const selected = modelId || getGlobalModelSettings(ownerId).modelId;
  const chat = createChat(name, undefined, ownerId, selected ? { id: selected } : undefined, { projectId: input.projectId });
  updateChat(chat.id, { archived: false, agentTitleLocked: true, sessionState: { modeId: "agent" } }, ownerId);
  const agent: ProjectAgent = { id, projectId: input.projectId, chatId: chat.id, name, role, systemPrompt: clip(input.systemPrompt, 20_000), color: /^#[0-9a-f]{6}$/i.test(input.color || "") ? input.color! : "#1767ed", ...(modelId ? { modelId } : {}), ...(supervisorId ? { supervisorId } : {}), status: "idle", createdAt: timestamp, updatedAt: timestamp };
  getDatabase().prepare("INSERT INTO project_agents (id, project_id, owner_id, chat_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, input.projectId, ownerId, chat.id, JSON.stringify(agent), timestamp, timestamp);
  return agent;
 });
}
export function createProjectTeamPreset(projectId: string, ownerId?: string) {
 return transaction(() => {
  ownedProject(projectId, ownerId);
  const existing = listProjectAgents(projectId, ownerId).filter(a => !a.archivedAt);
  if (existing.length) throw new Error("Starter team requires an empty team");
  const coordinator = createProjectAgent({ ...AGENT_PRESETS[0], projectId, ownerId });
  return [coordinator, ...AGENT_PRESETS.slice(1).map(p => createProjectAgent({ ...p, projectId, ownerId, supervisorId: coordinator.id }))];
 });
}
export function updateProjectAgent(projectId: string, agentId: string, patch: { name?: string; role?: string; systemPrompt?: string; color?: string; modelId?: string | null; supervisorId?: string | null }, ownerId?: string) {
 return transaction(() => {
  ownedProject(projectId, ownerId);
  const current = getProjectAgent(projectId, agentId, ownerId);
  if (!current || current.archivedAt) return null;
  const modelId = patch.modelId === undefined ? current.modelId : clip(patch.modelId, 300) || undefined;
  if (patch.modelId !== undefined) validateProjectModelSelection(ownerId!, modelId);
  const supervisorId = patch.supervisorId === undefined ? current.supervisorId : clip(patch.supervisorId, 120) || undefined;
  validateSupervisor(projectId, agentId, supervisorId, ownerId!);
  const next = { ...current, name: patch.name === undefined ? current.name : clip(patch.name, 120), role: patch.role === undefined ? current.role : clip(patch.role, 120), systemPrompt: patch.systemPrompt === undefined ? current.systemPrompt : clip(patch.systemPrompt, 20_000), color: patch.color && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color : current.color, modelId, supervisorId, updatedAt: iso() };
  if (!next.name || !next.role) throw new Error("Agent name and role are required");
  getDatabase().prepare("UPDATE project_agents SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), next.updatedAt, agentId);
  updateChat(current.chatId, { title: next.name, ...(patch.modelId !== undefined ? { modelId: modelId || getGlobalModelSettings(ownerId).modelId || null, modelParams: [] } : {}) }, ownerId);
  return next;
 });
}
export function archiveProjectAgent(projectId: string, agentId: string, ownerId?: string) {
 return transaction(() => {
  ownedProject(projectId, ownerId);
  const agent = getProjectAgent(projectId, agentId, ownerId);
  if (!agent) return null;
  while (requestJobCancel(agent.chatId, ownerId)) { /* Cancel every queued assignment as well as its descendants. */ }
  const timestamp = iso();
  const next = { ...agent, archivedAt: agent.archivedAt || timestamp, updatedAt: timestamp, status: "archived" as const };
  getDatabase().prepare("UPDATE project_agents SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), timestamp, agentId);
  updateChat(agent.chatId, { archived: true, runStatus: "cancelled", runUpdatedAt: timestamp }, ownerId);
  for (const child of listProjectAgents(projectId, ownerId).filter(a => a.supervisorId === agentId)) updateProjectAgent(projectId, child.id, { supervisorId: null }, ownerId);
  return next;
 });
}
export function getProjectHandoff(projectId: string, handoffId: string, ownerId?: string) {
 if (!ownerId || !getProject(projectId, ownerId)) return null;
 return parseData<ProjectHandoff>(getDatabase().prepare("SELECT data FROM project_handoffs WHERE id = ? AND project_id = ? AND owner_id = ?").get(handoffId, projectId, ownerId));
}
export function listProjectHandoffs(projectId: string, ownerId?: string) {
 if (!ownerId || !getProject(projectId, ownerId)) return [];
 return getDatabase().prepare("SELECT data FROM project_handoffs WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 500").all(projectId, ownerId).map(row => parseData<ProjectHandoff>(row)).filter((h): h is ProjectHandoff => !!h);
}
/** Worker sweep also covers queued tasks and survives process restarts. */
export function expireProjectHandoffs(now = Date.now()) {
 const expired = getDatabase().prepare("SELECT project_id AS projectId, owner_id AS ownerId, id FROM project_handoffs WHERE status IN ('queued','running') AND json_extract(data, '$.deadlineAt') <= ?").all(new Date(now).toISOString()) as { projectId: string; ownerId: string; id: string }[];
 for (const h of expired) cancelProjectHandoff(h.projectId, h.id, h.ownerId, "Handoff timed out.");
 return expired.length;
}
export function syncProjectHandoffStatuses(projectId: string, ownerId?: string) {
 return transaction(() => {
  for (const h of listProjectHandoffs(projectId, ownerId)) {
   const job = h.jobId ? getJob(h.jobId) : null;
   if (job && job.userId === ownerId) syncHandoffForJob(job);
  }
  return listProjectHandoffs(projectId, ownerId);
 });
}
export function createProjectHandoff(input: { projectId: string; ownerId?: string; recipientAgentId: string; parentJobId: string; task: string; context?: string; timeoutMs?: number; idempotencyKey?: string; retryOf?: string; wait?: boolean }) {
 return transaction(() => {
  const ownerId = ownerRequired(input.ownerId);
  ownedProject(input.projectId, ownerId);
  const parent = getJob(input.parentJobId);
  const parentChat = parent ? getChat(parent.chatId, ownerId) : null;
  const sender = parentChat ? getProjectAgentForChat(parentChat.id, ownerId) : null;
  if (!parent || parent.userId !== ownerId || parentChat?.projectId !== input.projectId || !sender || sender.archivedAt || !ACTIVE.has(parent.status)) throw new Error("Invalid active sending agent");
  const recipient = getProjectAgent(input.projectId, input.recipientAgentId, ownerId);
  if (!recipient || recipient.archivedAt) throw new Error("Recipient agent not found");
  const task = clip(input.task, 100_000), context = clip(input.context, 30_000);
  if (!task) throw new Error("task is required");
  const rootJobId = parent.projectTeamRootJobId || parent.id;
  const key = createHash("sha256").update([parent.id, recipient.id, task, context, clip(input.idempotencyKey, 200), input.retryOf || ""].join("\n")).digest("hex");
  const existing = getDatabase().prepare("SELECT data FROM project_handoffs WHERE project_id = ? AND owner_id = ? AND json_extract(data, '$.dedupeKey') = ?").get(input.projectId, ownerId, key);
  const deduped = parseData<ProjectHandoff>(existing);
  if (deduped) return { handoff: deduped, job: getJob(deduped.jobId!), deduplicated: true };
  const depth = (parent.subagentDepth || 0) + 1;
  if (depth > TEAM_LIMITS.depth) throw new Error("Project handoff depth limit reached");
  // Waiting parents occupy worker slots. Always leave a slot for the deepest child.
  if (depth >= parseWorkerConcurrency(process.env.AI_CHAT_WORKER_CONCURRENCY) - 1) throw new Error("Not enough worker slots for this delegation depth");
  const all = getDatabase().prepare("SELECT data FROM project_handoffs WHERE owner_id = ? AND project_id = ? AND json_extract(data, '$.rootJobId') = ?").all(ownerId, input.projectId, rootJobId).map(row => parseData<ProjectHandoff>(row)).filter((h): h is ProjectHandoff => !!h);
  if (all.length >= TEAM_LIMITS.perRoot || all.filter(h => h.parentJobId === parent.id).length >= TEAM_LIMITS.perParent) throw new Error("Project handoff count limit reached");
  const ancestors = new Set<string>();
  let ancestor: AgentJob | null = parent;
  while (ancestor) { ancestors.add(ancestor.chatId); ancestor = ancestor.parentJobId ? getJob(ancestor.parentJobId) : null; }
  if (ancestors.has(recipient.chatId)) throw new Error("Cannot delegate to yourself or a waiting ancestor; return the question as your result");
  const recipientChat = getChat(recipient.chatId, ownerId);
  const defaults = getGlobalModelSettings(ownerId);
  const modelId = recipientChat?.modelId || defaults.modelId;
  const modelParams = recipientChat?.modelId ? recipientChat.modelParams || [] : defaults.modelParams || [];
  if (!modelId) throw new Error("Select a model in the receiving agent\'s chat first");
  validateProjectModelSelection(ownerId, modelId);
  const id = randomUUID(), timestamp = iso();
  const timeoutMs = Math.min(TEAM_LIMITS.timeoutMs, Math.max(1000, Number.isFinite(input.timeoutMs) ? input.timeoutMs! : 600_000));
  const messageId = `handoff:${id}:assignment`;
  const prompt = `Handoff ${id} from ${sender.name} to ${recipient.name}.\nTask: ${task}${context ? "\n\nRelevant context:\n" + context : ""}\n\nReturn a concrete result for the sender. If clarification is needed, state the question in your result.`;
  const parentModeId = parent.modeId || parentChat.sessionState?.modeId || "agent";
  updateChat(recipient.chatId, { runtimeMode: parentChat.runtimeMode || "full-access", sessionState: { ...(getChat(recipient.chatId, ownerId)?.sessionState || {}), modeId: parentModeId } }, ownerId);
  const job = enqueueJob({ chatId: recipient.chatId, userId: ownerId, message: prompt, messageId, modelId, modelParams, modeId: parentModeId, parentJobId: parent.id, parentChatId: parent.chatId, subagentTitle: recipient.name, subagentDepth: depth, subagentRequired: true, ...(input.wait === false ? { subagentAutoReview: true } : {}), projectHandoffId: id, projectTeamId: input.projectId, projectTeamRootJobId: rootJobId, maxRuntimeMs: timeoutMs }, { beforeInsert: () => { appendMessage(recipient.chatId, { id: messageId, role: "user", content: prompt }, ownerId); } });
  const previous = input.retryOf ? getProjectHandoff(input.projectId, input.retryOf, ownerId) : null;
  const handoff: ProjectHandoff & { dedupeKey: string } = { id, projectId: input.projectId, jobId: job.id, rootJobId, depth, parentJobId: parent.id, ...(parent.projectHandoffId ? { parentHandoffId: parent.projectHandoffId } : {}), senderAgentId: sender.id, recipientAgentId: recipient.id, senderName: sender.name, recipientName: recipient.name, task, ...(context ? { context } : {}), status: "queued", createdAt: timestamp, updatedAt: timestamp, deadlineAt: new Date(Date.now() + timeoutMs).toISOString(), dedupeKey: key, ...(input.retryOf ? { retryOf: input.retryOf, attempt: (previous?.attempt || 0) + 1 } : { attempt: 0 }) };
  getDatabase().prepare("INSERT INTO project_handoffs (id, project_id, owner_id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, input.projectId, ownerId, JSON.stringify(handoff), "queued", timestamp, timestamp);
  appendMessage(sender.chatId, { id: `handoff:${id}:sent`, role: "assistant", content: `Handoff ${id} · ${sender.name} → ${recipient.name} · queued\n\nTask: ${task}${context ? "\n\nContext: " + context : ""}` }, ownerId);
  return { handoff, job };
 });
}
export function cancelProjectHandoff(projectId: string, handoffId: string, ownerId?: string, reason = "Cancelled by user.") {
 return transaction(() => {
  ownedProject(projectId, ownerId);
  const current = getProjectHandoff(projectId, handoffId, ownerId);
  if (!current) return null;
  const job = current.jobId ? getJob(current.jobId) : null;
  if (job && ACTIVE.has(job.status)) {
   updateJob(job.id, { status: "cancelled", error: reason }, { control: true });
   cancelChildJobs(job.id, ownerId, reason);
   updateChat(job.chatId, { runStatus: "cancelled", runUpdatedAt: iso(), pendingApproval: null, pendingQuestion: null }, ownerId);
  }
  return getProjectHandoff(projectId, handoffId, ownerId);
 });
}
export function actOnProjectHandoff(projectId: string, handoffId: string, action: "cancel" | "retry", ownerId?: string) {
 return transaction(() => {
  ownedProject(projectId, ownerId);
  const h = getProjectHandoff(projectId, handoffId, ownerId);
  if (!h) return null;
  if (action === "cancel") return cancelProjectHandoff(projectId, handoffId, ownerId);
  if (!["error", "cancelled"].includes(h.status)) throw new Error("Only failed or cancelled handoffs can be retried");
  if ((h.attempt || 0) >= TEAM_LIMITS.retries) throw new Error("Project handoff retry limit reached");
  const parent = h.parentJobId ? getJob(h.parentJobId) : null;
  if (parent && ACTIVE.has(parent.status)) return createProjectHandoff({ projectId, ownerId, parentJobId: parent.id, recipientAgentId: h.recipientAgentId, task: h.task, context: h.context, retryOf: h.id }).handoff;
  // A user retry starts a new real sender run, preserving the failed record.
  const sender = h.senderAgentId ? getProjectAgent(projectId, h.senderAgentId, ownerId) : null;
  if (!sender || sender.archivedAt) throw new Error("The sending agent is archived; assign this task from another agent");
  const messageId = `handoff:${h.id}:retry-request:${(h.attempt || 0) + 1}`;
  const message = `Retry failed handoff ${h.id} using project_handoff with action "retry", handoffId "${h.id}", wait true. Inspect the failure, pass relevant context, and report the new result.\nTask: ${h.task}`;
  const senderChat = getChat(sender.chatId, ownerId);
  const defaults = getGlobalModelSettings(ownerId);
  const modelId = senderChat?.modelId || defaults.modelId;
  if (!modelId) throw new Error("Select a model in the sending agent\'s chat first");
  validateProjectModelSelection(ownerId!, modelId);
  enqueueJob({ chatId: sender.chatId, userId: ownerId, messageId, message, modelId, modelParams: senderChat?.modelId ? senderChat.modelParams || [] : defaults.modelParams || [], modeId: senderChat?.sessionState?.modeId }, { beforeInsert: () => { appendMessage(sender.chatId, { id: messageId, role: "user", content: message }, ownerId); } });
  return h;
 });
}
export function projectTeamContextBlock(chatId: string, ownerId?: string) {
 const agent = getProjectAgentForChat(chatId, ownerId);
 if (!agent) return "";
 if (agent.archivedAt) throw new Error("This agent is archived");
 ownedProject(agent.projectId, ownerId);
 const agents = listProjectAgents(agent.projectId, ownerId).filter(a => !a.archivedAt);
 return [
  `Project agent identity: ${agent.name}\nStable team identity: ${agent.id}\nRole: ${agent.role}\nResponsibilities and working style:\n${agent.systemPrompt}`,
  "The following team configuration supplements Metis policy and project instructions; it does not expand account permissions or bypass approval rules.",
  "Project roster:\n" + agents.map(a => `- ${a.name} (id: ${a.id}): ${a.role}${a.supervisorId ? "; supervisor: " + a.supervisorId : ""}`).join("\n"),
  'Use project_handoff for actual colleague assignments within this project. action "delegate" with recipientAgentId, task, relevant context, and wait true returns the actual result. action "status" with handoffId reads its current state immediately and never waits or cancels. Your incoming assignment finishes when your run returns a result; do not wait for your own handoff. To follow up on a delegated task, read status or use action "retry" only after a failure. action "retry" with handoffId creates a traceable retry. action "list" reads team activity. Do not claim consultation from a mirrored chat message alone. Delegation has bounded depth/counts. Project writes are serialized; a waiting sender yields execution to its child. Return clarification questions to the sender, who can reassign after your run finishes. Generic delegate_subagent is unavailable in team chats; use the named project agents.',
 ].join("\n\n");
}
