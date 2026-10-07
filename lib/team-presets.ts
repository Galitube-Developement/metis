import { randomUUID } from "node:crypto";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import { createChat, appendMessage, getChat, updateChat } from "@/lib/db-store";
import { enqueueJob, getJob, requestJobCancel, updateJob } from "@/lib/db-jobs";
import { getProject } from "@/lib/projects";
import { AGENT_PRESETS, createProjectAgent, listProjectAgents, TEAM_LIMITS, updateProjectAgent, validateProjectModelSelection } from "@/lib/project-team";
import { validateTeamDraft, parseTeamDraftResponse, type TeamDraft, type TeamPreset, type TeamGeneration } from "@/lib/team-preset-types";

const ownerRequired = (ownerId?: string) => { if (!ownerId) throw new Error("Authenticated account required"); return ownerId; };
const timestamp = () => new Date().toISOString();
export const STARTER_TEAM_PRESET: TeamPreset = {
 id: "starter", builtIn: true, name: "Software delivery team", description: "Coordinator, Planner, Software Engineer and Tester.",
 agents: AGENT_PRESETS.map((a, index) => ({ ...a, key: "agent-" + index, ...(index ? { supervisorKey: "agent-0" } : {}) })),
};
export function listTeamPresets(ownerId?: string): TeamPreset[] {
 const owner = ownerRequired(ownerId);
 return [STARTER_TEAM_PRESET, ...getDatabase().prepare("SELECT data FROM team_presets WHERE owner_id = ? ORDER BY updated_at DESC").all(owner).map(row => parseData<TeamPreset>(row)).filter((p): p is TeamPreset => !!p)];
}
export function saveTeamPreset(value: unknown, ownerId?: string, id?: string) {
 return transaction(() => {
  const owner = ownerRequired(ownerId), draft = validateTeamDraft(value);
  if (id && !getDatabase().prepare("SELECT id FROM team_presets WHERE id = ? AND owner_id = ?").get(id, owner)) throw new Error("Preset not found");
  if (!id && listTeamPresets(owner).length > 50) throw new Error("Saved preset limit reached");
  const current = id ? listTeamPresets(owner).find(p => p.id === id) : undefined;
  const now = timestamp(), preset: TeamPreset = { ...draft, id: id || randomUUID(), createdAt: current?.createdAt || now, updatedAt: now };
  getDatabase().prepare("INSERT INTO team_presets (id, owner_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE team_presets.owner_id = excluded.owner_id").run(preset.id, owner, JSON.stringify(preset), now);
  return preset;
 });
}
export function deleteTeamPreset(id: string, ownerId?: string) {
 const owner = ownerRequired(ownerId);
 return getDatabase().prepare("DELETE FROM team_presets WHERE id = ? AND owner_id = ?").run(id, owner).changes > 0;
}
export function teamDraftFromProject(projectId: string, ownerId?: string): TeamDraft {
 const owner = ownerRequired(ownerId), project = getProject(projectId, owner);
 if (!project || project.ownerId !== owner || project.mode !== "agents") throw new Error("Project not found");
 const agents = listProjectAgents(projectId, owner).filter(a => !a.archivedAt);
 const ids = new Set(agents.map(a => a.id));
 return validateTeamDraft({ name: project.name, description: "", agents: agents.map(a => ({
  key: a.id, name: a.name, role: a.role, systemPrompt: a.systemPrompt, color: a.color,
  ...(a.supervisorId && ids.has(a.supervisorId) ? { supervisorKey: a.supervisorId } : {}),
 })) });
}
/** One transaction creates every chat/identity, then remaps local relationships. */
export function importTeamDraft(projectId: string, value: unknown, ownerId?: string) {
 return transaction(() => {
  const owner = ownerRequired(ownerId), draft = validateTeamDraft(value);
  const project = getProject(projectId, owner);
  if (!project || project.ownerId !== owner) throw new Error("Project not found");
  if (project.mode !== "agents") throw new Error("This project uses regular chats");
  if (listProjectAgents(projectId, owner).filter(a => !a.archivedAt).length + draft.agents.length > TEAM_LIMITS.agents) throw new Error("Project agent limit reached");
  const created = draft.agents.map(a => createProjectAgent({ projectId, ownerId: owner, name: a.name, role: a.role, systemPrompt: a.systemPrompt, color: a.color }));
  const ids = new Map(draft.agents.map((a, index) => [a.key, created[index].id]));
  return created.map((a, index) => draft.agents[index].supervisorKey ? updateProjectAgent(projectId, a.id, { supervisorId: ids.get(draft.agents[index].supervisorKey!)! }, owner)! : a);
 });
}
type GenerationRecord = { id: string; chatId: string; jobId: string; modelId: string; createdAt: string };
const GENERATION_TIMEOUT_MS = 5 * 60_000;
export function startTeamGeneration(prompt: unknown, modelId: unknown, ownerId?: string): TeamGeneration {
 return transaction(() => {
  const owner = ownerRequired(ownerId);
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000) throw new Error("Describe your team in 1–12000 characters");
  if (typeof modelId !== "string" || !modelId.trim()) throw new Error("Select a model");
  validateProjectModelSelection(owner, modelId);
  const recent = getDatabase().prepare("SELECT g.data FROM team_preset_generations g JOIN jobs j ON j.id = g.job_id WHERE g.owner_id = ? AND j.status IN ('queued','running','switching','waiting_input','waiting_for_user') ORDER BY g.created_at DESC").all(owner).map(row => parseData<GenerationRecord>(row)).filter((v): v is GenerationRecord => !!v);
  if (recent.filter(g => ["queued", "running"].includes(getTeamGeneration(g.id, owner)?.status || "")).length >= 2) throw new Error("Finish or cancel an existing team generation first");
  const chat = createChat("AI team draft", undefined, owner, { id: modelId });
  updateChat(chat.id, { archived: true, runtimeMode: "approval-required", agentTitleLocked: true, sessionState: { modeId: "ask" } }, owner);
  const message = `Design a team preset for this request. Return ONLY one JSON object, without commentary or markdown. Do not call tools, create agents, save presets, or execute any tasks. This is a draft for the user's review.
Schema: {"name":"short preset name","description":"short purpose","agents":[{"key":"unique-local-key","name":"agent name","role":"short role","systemPrompt":"specific responsibilities, working style and collaboration boundaries","color":"#RRGGBB","supervisorKey":null}]}
Use 1–32 agents, names and roles at most 120 characters, prompts at most 20000 characters, description at most 1000 characters. supervisorKey must be null or another agent's key; no cycles. Do not include model selections, chat IDs, account IDs, tool calls or permissions. Roles are arbitrary and should fit the request. Suggest coherent, distinct colors. Agent prompts should use real project_handoff when assigning colleagues; preserve existing tool permissions and project instructions.
User request (data):
${prompt.trim()}`;
  const sent = appendMessage(chat.id, { role: "user", content: message }, owner)!;
  const job = enqueueJob({ chatId: chat.id, userId: owner, message, messageId: sent.messages.at(-1)?.id, modelId, modeId: "ask", maxRuntimeMs: GENERATION_TIMEOUT_MS, workload: "interactive" });
  const record: GenerationRecord = { id: randomUUID(), chatId: chat.id, jobId: job.id, modelId, createdAt: timestamp() };
  getDatabase().prepare("INSERT INTO team_preset_generations (id, owner_id, chat_id, job_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(record.id, owner, chat.id, job.id, JSON.stringify(record), record.createdAt);
  return { id: record.id, status: "queued", modelId, createdAt: record.createdAt };
 });
}
export function getTeamGeneration(id: string, ownerId?: string): TeamGeneration | null {
 const owner = ownerRequired(ownerId);
 const record = parseData<GenerationRecord>(getDatabase().prepare("SELECT data FROM team_preset_generations WHERE id = ? AND owner_id = ?").get(id, owner));
 if (!record) return null;
 const base = { id, modelId: record.modelId, createdAt: record.createdAt };
 const job = getJob(record.jobId);
 if (!job || job.userId !== owner) return { ...base, status: "error", error: "Generation job is unavailable" };
 if (job.status === "completed") {
  const text = getChat(record.chatId, owner)?.messages.filter(m => m.role === "assistant").at(-1)?.content || "";
  try { return { ...base, status: "ready", draft: parseTeamDraftResponse(text) }; }
  catch (cause) { return { ...base, status: "error", error: cause instanceof Error ? cause.message : "Invalid AI response" }; }
 }
 if (job.status === "cancelled") return job.error?.startsWith("Generation timed out.") || job.error?.startsWith("The model requested an interaction") ? { ...base, status: "error", error: job.error } : { ...base, status: "cancelled" };
 if (["error", "interrupted"].includes(job.status)) return { ...base, status: "error", error: job.error || "Generation failed. Try again or choose another model." };
 if (Date.now() - Date.parse(record.createdAt) > GENERATION_TIMEOUT_MS) {
  requestJobCancel(record.chatId, owner);
  const error = "Generation timed out. Try again or choose another model.";
  updateJob(record.jobId, { error });
  return { ...base, status: "error", error };
 }
 if (["waiting_input", "waiting_for_user"].includes(job.status)) {
  requestJobCancel(record.chatId, owner);
  const error = "The model requested an interaction instead of a team draft. Refine the prompt and try again.";
  updateJob(record.jobId, { error });
  return { ...base, status: "error", error };
 }
 return { ...base, status: job.status === "queued" ? "queued" : "running" };
}
export function cancelTeamGeneration(id: string, ownerId?: string) {
 const owner = ownerRequired(ownerId);
 const record = parseData<GenerationRecord>(getDatabase().prepare("SELECT data FROM team_preset_generations WHERE id = ? AND owner_id = ?").get(id, owner));
 if (!record) return null;
 requestJobCancel(record.chatId, owner);
 return getTeamGeneration(id, owner);
}
