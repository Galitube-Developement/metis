import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-project-team-test-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dataDir;
process.env.AGENT_CWD = dataDir;
process.env.MCP_BEARER_TOKEN = "isolated-team-test";
process.env.AI_CHAT_WORKER_CONCURRENCY = "8";
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
test("persistent project team runtime", async (t) => {
const [{ createUser }, projects, store, jobs, team, { getDatabase }, { modelKey }, { POST }, { buildProviderPrompt }] = await Promise.all([
 import("../lib/auth"), import("../lib/projects"), import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/project-team"), import("../lib/sqlite"), import("../lib/providers/types"), import("../app/api/internal/project-handoff/route"), import("../lib/providers/prompt-context"),
]);
after(() => rmSync(dataDir, { recursive: true, force: true }));
const owner = createUser("team-owner", "test-only-password").id;
const other = createUser("other-owner", "other-password").id;
const connectionId = "test-connection";
const model = modelKey("openai", "discovered-test-model", connectionId);
getDatabase().prepare("INSERT INTO provider_connections(id,owner_id,provider_key,slug,label,auth_type,config,enabled,created_at,updated_at) VALUES (?,?, 'openai','test-provider','Test provider','api_key','{}',1,datetime('now'),datetime('now'))").run(connectionId, owner);
getDatabase().prepare("INSERT INTO provider_models(connection_id,canonical_id,display_name,capabilities,discovered_at) VALUES (?, 'discovered-test-model','Discovered test model','{}',datetime('now'))").run(connectionId);
function fixture(modeId = "agent") {
 const project = projects.createProject({ ownerId: owner, name: "Team", mode: "agents", instructions: "Preserve existing architecture." });
 const agents = team.createProjectTeamPreset(project.id, owner);
 for (const a of agents) team.updateProjectAgent(project.id, a.id, { modelId: model }, owner);
 const sender = agents[0];
 store.updateChat(sender.chatId, { runtimeMode: "approval-required", sessionState: { modeId } }, owner);
 const parent = jobs.enqueueJob({ chatId: sender.chatId, userId: owner, message: "Implement feature", modelId: model, modeId });
 const claimed = jobs.claimNextJob({ workerId: "test-worker" });
 assert.equal(claimed?.id, parent.id);
 return { project, agents, sender, parent: claimed! };
}
function request(f: ReturnType<typeof fixture>, body: Record<string, unknown>, ownerOverride = owner) {
 return new Request("http://test/api/internal/project-handoff", { method: "POST", headers: { authorization: "Bearer isolated-team-test", "content-type": "application/json", "x-ai-chat-id": f.sender.chatId, "x-ai-chat-job-id": f.parent.id, "x-ai-chat-user-id": ownerOverride, "x-ai-chat-worker-id": f.parent.leaseOwner!, "x-ai-chat-lease-token": f.parent.leaseToken! }, body: JSON.stringify(body) });
}
function stop(f: ReturnType<typeof fixture>) { jobs.requestJobCancel(f.sender.chatId, owner); }
await t.test("existing projects default to chat and new agent mode persists immutably", () => {
 const legacy = projects.createProject({ ownerId: owner, name: "Old project" });
 assert.equal(projects.getProject(legacy.id, owner)?.mode, "chat");
 const f = fixture();
 assert.equal(projects.getProject(f.project.id, owner)?.mode, "agents");
 projects.updateProject(f.project.id, { name: "Renamed", mode: "chat" } as never, owner);
 assert.equal(projects.getProject(f.project.id, owner)?.mode, "agents");
 assert.throws(() => team.createProjectAgent({ projectId: legacy.id, ownerId: owner, name: "No", role: "No" }), /regular chats/);
 stop(f);
});
await t.test("preset identities, arbitrary roles, prompts, edits, and supervisor cycles persist", () => {
 const f = fixture();
 assert.deepEqual(f.agents.map(a => a.name), ["Coordinator", "Planner", "Software Engineer", "Tester"]);
 const a = team.createProjectAgent({ projectId: f.project.id, ownerId: owner, name: "Archivist", role: "Preserves decisions", systemPrompt: "Always record decision evidence.", supervisorId: f.sender.id });
 const edited = team.updateProjectAgent(f.project.id, a.id, { name: "Historian", systemPrompt: "Use exact dates.", supervisorId: null }, owner)!;
 assert.equal(edited.chatId, a.chatId);
 assert.equal(team.getProjectAgent(f.project.id, a.id, owner)?.systemPrompt, "Use exact dates.");
 assert.equal(store.getChat(a.chatId, owner)?.title, "Historian");
 assert.equal(edited.supervisorId, undefined);
 assert.throws(() => team.updateProjectAgent(f.project.id, f.sender.id, { supervisorId: f.agents[1].id }, owner), /cycle/);
 const prompt = buildProviderPrompt({ job: { ...f.parent, chatId: a.chatId } });
 assert.match(prompt, /Historian/); assert.match(prompt, /Use exact dates/); assert.match(prompt, /Preserve existing architecture/);
 stop(f);
});
await t.test("account and project isolation fail closed, including missing owners and undiscovered models", async () => {
 const f = fixture();
 assert.deepEqual(team.listProjectAgents(f.project.id, other), []);
 assert.deepEqual(team.listProjectHandoffs(f.project.id), []);
 assert.equal(team.getProjectAgent(f.project.id, f.sender.id, other), null);
 assert.throws(() => team.createProjectAgent({ projectId: f.project.id, ownerId: other, name: "Wrong", role: "Wrong" }), /not found/);
 assert.throws(() => team.createProjectAgent({ projectId: f.project.id, ownerId: owner, name: "Wrong", role: "Wrong", modelId: modelKey("openai", "invented-model", connectionId) }), /not been discovered/);
 const response = await POST(request(f, { recipientAgentId: f.agents[1].id, task: "No" }, other));
 assert.equal(response.status, 403);
 const second = projects.createProject({ ownerId: owner, mode: "agents" });
 const stranger = team.createProjectAgent({ projectId: second.id, ownerId: owner, name: "Stranger", role: "Elsewhere", modelId: model });
 assert.throws(() => team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: stranger.id, task: "No" }), /Recipient/);
 stop(f);
});
await t.test("chat-selected model and options control handoffs and retries despite legacy agent overrides", () => {
 const f = fixture();
 const selected = modelKey("openai", "chat-selected-model", connectionId);
 getDatabase().prepare("INSERT INTO provider_models(connection_id,canonical_id,display_name,capabilities,discovered_at) VALUES (?, 'chat-selected-model','Chat selection','{}',datetime('now'))").run(connectionId);
 const recipient = f.agents[1];
 const params = [{ id: "reasoning", value: "high" }];
 store.updateChat(recipient.chatId, { modelId: selected, modelParams: params }, owner);
 getDatabase().prepare("UPDATE project_agents SET data = json_set(data, '$.modelId', 'retired-agent-model') WHERE id = ?").run(recipient.id);
 assert.ok(team.updateProjectAgent(f.project.id, recipient.id, { role: "Updated role" }, owner));
 assert.equal(store.getChat(recipient.chatId, owner)?.modelId, selected);
 assert.deepEqual(store.getChat(recipient.chatId, owner)?.modelParams, params);
 const assigned = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: recipient.id, task: "Use my chat selection" });
 assert.equal(assigned.job?.modelId, selected);
 assert.deepEqual(assigned.job?.modelParams, params);
 team.cancelProjectHandoff(f.project.id, assigned.handoff.id, owner);
 stop(f);
 store.updateChat(f.sender.chatId, { modelId: selected, modelParams: params }, owner);
 team.actOnProjectHandoff(f.project.id, assigned.handoff.id, "retry", owner);
 const retry = jobs.getActiveJob(f.sender.chatId, owner);
 assert.equal(retry?.modelId, selected);
 assert.deepEqual(retry?.modelParams, params);
 stop(f);
});
await t.test("Coordinator → Planner → Engineer → Tester uses real queue jobs, replies, and mirrors without duplicate execution", async () => {
 const f = fixture();
 for (const [index, a] of f.agents.slice(1).entries()) {
  const body = { recipientAgentId: a.id, task: "Phase " + index, context: index ? "Use the previous result" : "Inspect the requested feature", wait: true };
  const pending = POST(request(f, body));
  await new Promise(resolve => setTimeout(resolve, 15));
  const child = jobs.claimNextJob({ workerId: "child-" + index });
  assert.ok(child);
  assert.equal(child.chatId, a.chatId);
  assert.equal(child.modeId, "agent");
  assert.equal(store.getChat(a.chatId, owner)?.runtimeMode, "approval-required");
  store.appendMessage(a.chatId, { role: "assistant", content: "Concrete worker result " + index }, owner);
  jobs.updateJob(child.id, { status: "completed" });
  const response = await pending;
  assert.equal(response.status, 200);
  const returned = await response.json();
  assert.equal(returned.status, "completed");
  assert.equal(returned.result, "Concrete worker result " + index);
  const repeated = await POST(request(f, body));
  assert.equal((await repeated.json()).deduplicated, true);
  assert.equal(jobs.listJobs(a.chatId, owner).length, 1);
 }
 const handoffs = team.listProjectHandoffs(f.project.id, owner);
 assert.equal(handoffs.length, 3);
 assert.ok(handoffs.every(h => h.status === "completed" && h.senderAgentId === f.sender.id));
 const senderMessages = store.getChat(f.sender.chatId, owner)!.messages;
 assert.equal(senderMessages.filter(m => m.id.includes(":result:sender")).length, 3);
 assert.equal(jobs.listJobs(f.sender.chatId, owner).length, 1);
 stop(f);
});
await t.test("completed replies reconcile across worker projection leases without duplicate messages", () => {
 const f = fixture();
 const h = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Reply through lease" });
 jobs.updateJob(f.parent.id, { projectWaitingForHandoffId: h.handoff.id });
 const child = jobs.claimNextJob({ workerId: "projection-worker" })!;
 store.appendMessage(child.chatId, { role: "assistant", content: "Verified child result" }, owner);
 process.env.AI_CHAT_JOB_ID = child.id;
 process.env.AI_CHAT_WORKER_ID = child.leaseOwner!;
 process.env.AI_CHAT_JOB_LEASE_TOKEN = child.leaseToken!;
 try { jobs.updateJob(child.id, { status: "completed" }); }
 finally { delete process.env.AI_CHAT_JOB_ID; delete process.env.AI_CHAT_WORKER_ID; delete process.env.AI_CHAT_JOB_LEASE_TOKEN; }
 team.syncProjectHandoffStatuses(f.project.id, owner);
 team.syncProjectHandoffStatuses(f.project.id, owner);
 const replies = store.getChat(f.sender.chatId, owner)!.messages.filter(m => m.id === `handoff:${h.handoff.id}:result:sender`);
 assert.equal(replies.length, 1);
 assert.match(replies[0].content, /Verified child result/);
 stop(f);
});
await t.test("an incoming handoff status query never waits on or cancels its own job", async () => {
 const f = fixture();
 const h = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Real assignment" });
 jobs.updateJob(f.parent.id, { projectWaitingForHandoffId: h.handoff.id });
 const child = jobs.claimNextJob({ workerId: "status-worker" })!;
 const req = request(f, { action: "status", handoffId: h.handoff.id, wait: true, timeoutMs: 1000 });
 req.headers.set("x-ai-chat-id", child.chatId); req.headers.set("x-ai-chat-job-id", child.id);
 req.headers.set("x-ai-chat-worker-id", child.leaseOwner!); req.headers.set("x-ai-chat-lease-token", child.leaseToken!);
 const result = await POST(req);
 assert.equal(result.status, 200);
 assert.equal((await result.json()).status, "running");
 assert.equal(jobs.getJob(child.id)?.status, "running");
 assert.equal(jobs.getJob(child.id)?.projectWaitingForHandoffId, undefined);
 stop(f);
});
await t.test("handoffs inherit read-only modes and reject spoofed sender or inactive leases", async () => {
 const f = fixture("ask");
 const response = await POST(request(f, { recipientAgentId: f.agents[1].id, senderAgentId: f.agents[2].id, task: "Read only", wait: false }));
 const result = await response.json();
 assert.equal(result.handoff.senderAgentId, f.sender.id);
 assert.equal(jobs.getJob(result.jobId)?.modeId, "ask");
 const invalid = request(f, { action: "list" });
 invalid.headers.set("x-ai-chat-lease-token", "wrong");
 assert.equal((await POST(invalid)).status, 401);
 stop(f);
});
await t.test("project scheduler prevents simultaneous writers while permitting a waiting sender's child", async () => {
 const f = fixture();
 const direct = jobs.enqueueJob({ chatId: f.agents[2].chatId, userId: owner, message: "Direct conflicting work", modelId: model });
 const handoff = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Child work" });
 assert.equal(jobs.claimNextJob(), null);
 jobs.updateJob(f.parent.id, { projectWaitingForHandoffId: handoff.handoff.id }, { control: true });
 const child = jobs.claimNextJob();
 assert.equal(child?.id, handoff.job!.id);
 assert.equal(jobs.claimNextJob(), null);
 jobs.updateJob(child!.id, { status: "completed" });
 // Unrelated root stays queued while the coordinator still owns this project.
 assert.equal(jobs.claimNextJob(), null);
 stop(f);
 assert.equal(jobs.claimNextJob()?.id, direct.id);
 jobs.requestJobCancel(direct.chatId, owner);
});
await t.test("cancellation stops descendants, persists terminal handoffs, and preserves histories on archive", () => {
 const f = fixture();
 const first = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "First" });
 jobs.updateJob(f.parent.id, { projectWaitingForHandoffId: first.handoff.id });
 const child = jobs.claimNextJob()!;
 const second = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: child.id, recipientAgentId: f.agents[2].id, task: "Second" });
 stop(f);
 assert.equal(jobs.getJob(first.job!.id)?.status, "cancelled");
 assert.equal(jobs.getJob(second.job!.id)?.status, "cancelled");
 assert.ok(team.listProjectHandoffs(f.project.id, owner).every(h => h.status === "cancelled"));
 const queued = [0].map(i => jobs.enqueueJob({ chatId: f.sender.chatId, userId: owner, message: "Queued " + i, modelId: model, parentJobId: f.parent.id }));
 const archived = team.archiveProjectAgent(f.project.id, f.sender.id, owner)!;
 assert.ok(queued.every(job => jobs.getJob(job.id)?.status === "cancelled"));
 assert.ok(archived.archivedAt);
 assert.ok(store.getChat(f.sender.chatId, owner)?.messages.length);
 assert.ok(team.listProjectAgents(f.project.id, owner).filter(a => a.id !== f.sender.id).every(a => !a.supervisorId));
 assert.throws(() => jobs.enqueueJob({ chatId: f.sender.chatId, userId: owner, message: "No" }), /active agent/);
});
await t.test("handoffs allow 60 minutes, cap larger requests and retain the 10-minute default", async () => {
 const f = fixture();
 for (const [requested, expected] of [[undefined, 600_000], [3_600_000, 3_600_000], [7_200_000, 3_600_000]] as const) {
  const response = await POST(request(f, { recipientAgentId: f.agents[1].id, task: "Deadline " + requested, wait: false, ...(requested === undefined ? {} : { timeoutMs: requested }) }));
  assert.equal(response.status, 200);
  const result = await response.json();
  const job = jobs.getJob(result.jobId)!;
  assert.equal(job.maxRuntimeMs, expected);
  const duration = Date.parse(result.handoff.deadlineAt) - Date.parse(result.handoff.createdAt);
  assert.ok(duration >= expected && duration < expected + 1_000);
  if (expected === 3_600_000) {
   assert.equal(team.expireProjectHandoffs(Date.parse(result.handoff.createdAt) + 30 * 60_000), 0);
   assert.equal(jobs.getJob(job.id)?.status, "queued");
   assert.equal(team.expireProjectHandoffs(Date.parse(result.handoff.deadlineAt) + 1), 1);
   assert.equal(jobs.getJob(job.id)?.status, "cancelled");
  } else team.cancelProjectHandoff(f.project.id, result.handoff.id, owner);
 }
 stop(f);
});
await t.test("timeouts cancel real queued jobs and retries retain the failed record", async () => {
 const f = fixture();
 const response = await POST(request(f, { recipientAgentId: f.agents[1].id, task: "Will time out", timeoutMs: 1000 }));
 const outcome = await response.json();
 assert.equal(outcome.status, "cancelled");
 assert.match(outcome.error, /timed out/);
 const retry = await POST(request(f, { action: "retry", handoffId: outcome.handoff.id, wait: false }));
 const next = await retry.json();
 assert.equal(next.handoff.retryOf, outcome.handoff.id);
 assert.equal(next.handoff.attempt, 1);
 assert.equal(team.getProjectHandoff(f.project.id, outcome.handoff.id, owner)?.status, "cancelled");
 stop(f);
});
await t.test("durable expiry and project deletion cancel dependent work without losing histories", async () => {
 const f = fixture();
 const h = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Persisted timeout", wait: false, timeoutMs: 1000 });
 const { createApproval, getApproval } = await import("../lib/db-approvals");
 const { createPendingQuestion, getPendingQuestion } = await import("../lib/db-questions");
 const approval = createApproval({ jobId: h.job!.id, chatId: f.agents[1].chatId, ownerId: owner, title: "Sensitive action" });
 const question = createPendingQuestion([{ question: "Clarify?" }], f.agents[1].chatId, owner, { jobId: h.job!.id });
 assert.equal(team.expireProjectHandoffs(Date.now() + 2000), 1);
 assert.equal(jobs.getJob(h.job!.id)?.status, "cancelled");
 assert.equal(getApproval(approval.approvalId, owner)?.decision, "deny");
 assert.equal(getPendingQuestion(question.questionId, owner)?.status, "cancelled");
 const second = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[2].id, task: "Project removed" });
 const deleted = projects.deleteProject(f.project.id, owner)!;
 assert.equal(jobs.getJob(second.job!.id)?.status, "cancelled");
 assert.ok(deleted.chatIds.includes(f.sender.chatId));
 assert.equal(store.getChat(f.agents[1].chatId, owner)?.archived, true);
 assert.ok(store.getChat(f.agents[1].chatId, owner)?.messages.length);
});
await t.test("root-wide budgets and linked retries cannot reset their counters", async () => {
 const f = fixture();
 let h = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Retry bounded" }).handoff;
 for (let attempt = 0; attempt < 3; attempt++) {
  team.cancelProjectHandoff(f.project.id, h.id, owner);
  const response = await POST(request(f, { action: "retry", handoffId: h.id, wait: false }));
  assert.equal(response.status, 200);
  h = (await response.json()).handoff;
 }
 team.cancelProjectHandoff(f.project.id, h.id, owner);
 const rejected = await POST(request(f, { action: "retry", handoffId: h.id, wait: false }));
 assert.equal(rejected.status, 400);
 assert.match((await rejected.json()).error, /retry limit/);
 stop(f);
 const g = fixture();
 const workers = [g.sender, ...[0, 1, 2, 3].map(i => team.createProjectAgent({ projectId: g.project.id, ownerId: owner, name: "Branch " + i, role: "Independent work", modelId: model }))];
 const parents = [g.parent, ...workers.slice(1).map(a => jobs.enqueueJob({ chatId: a.chatId, userId: owner, message: "Branch", modelId: model, parentJobId: g.parent.id, subagentDepth: 1 }))];
 for (const parent of parents.slice(0, 4)) {
  for (let i = 0; i < 8; i++) {
   const child = team.createProjectHandoff({ projectId: g.project.id, ownerId: owner, parentJobId: parent.id, recipientAgentId: g.agents[1].id, task: parent.id + ":" + i });
   team.cancelProjectHandoff(g.project.id, child.handoff.id, owner);
  }
 }
 assert.equal(team.listProjectHandoffs(g.project.id, owner).length, 32);
 assert.throws(() => team.createProjectHandoff({ projectId: g.project.id, ownerId: owner, parentJobId: parents[4].id, recipientAgentId: g.agents[1].id, task: "Fresh parent, exhausted root" }), /count limit/);
 stop(g);
});
await t.test("depth, root handoff counts, and self-delegation are bounded from trusted job ancestry", () => {
 const f = fixture();
 assert.throws(() => team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.sender.id, task: "Loop" }), /yourself/);
 for (let i = 0; i < 8; i++) {
  const h = team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Task " + i });
  team.cancelProjectHandoff(f.project.id, h.handoff.id, owner);
 }
 assert.throws(() => team.createProjectHandoff({ projectId: f.project.id, ownerId: owner, parentJobId: f.parent.id, recipientAgentId: f.agents[1].id, task: "Too many" }), /count limit/);
 stop(f);
 const g = fixture();
 const deep = jobs.enqueueJob({ chatId: g.agents[1].chatId, userId: owner, message: "Depth", parentJobId: g.parent.id, subagentDepth: 4, modelId: model });
 assert.throws(() => team.createProjectHandoff({ projectId: g.project.id, ownerId: owner, parentJobId: deep.id, recipientAgentId: g.agents[2].id, task: "Too deep" }), /depth limit/);
 stop(g);
});

await t.test("team management defaults off, persists per project, and never restricts the owner", async () => {
 const f = fixture();
 assert.equal(projects.getProject(f.project.id, owner)?.allowAgentManagement, false);
 getDatabase().prepare("UPDATE projects SET data = json_remove(data, '$.allowAgentManagement') WHERE id = ?").run(f.project.id);
 assert.equal(projects.getProject(f.project.id, owner)?.allowAgentManagement, false);
 assert.match(team.projectTeamContextBlock(f.sender.chatId, owner), /Team management is disabled/);
 for (const action of ["create_agent", "update_agent", "archive_agent"]) {
  const response = await POST(request(f, { action, agentId: f.agents[1].id, agent: { name: "Denied", role: "Denied" } }));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /disabled/);
 }
 assert.equal((await POST(request(f, { action: "list" }))).status, 200);
 const delegated = await POST(request(f, { recipientAgentId: f.agents[1].id, task: "Existing delegation remains available", wait: false }));
 assert.equal(delegated.status, 200);
 team.cancelProjectHandoff(f.project.id, (await delegated.json()).handoff.id, owner);
 const manual = team.createProjectAgent({ projectId: f.project.id, ownerId: owner, name: "Owner-created", role: "Manual management" });
 assert.ok(team.updateProjectAgent(f.project.id, manual.id, { role: "Still editable" }, owner));
 assert.ok(team.archiveProjectAgent(f.project.id, manual.id, owner));
 projects.updateProject(f.project.id, { allowAgentManagement: true }, owner);
 assert.equal(projects.getProject(f.project.id, owner)?.allowAgentManagement, true);
 assert.match(team.projectTeamContextBlock(f.sender.chatId, owner), /action "create_agent"/);
 assert.equal(projects.updateProject(f.project.id, { allowAgentManagement: false }, other), null);
 assert.equal(projects.getProject(f.project.id, owner)?.allowAgentManagement, true);
 const regular = projects.createProject({ ownerId: owner });
 projects.updateProject(regular.id, { allowAgentManagement: true }, owner);
 assert.equal(projects.getProject(regular.id, owner)?.allowAgentManagement, false);
 stop(f);
});
await t.test("enabled management creates, edits and archives real teammates while preserving runtime policy", async () => {
 const f = fixture();
 projects.updateProject(f.project.id, { allowAgentManagement: true }, owner);
 const response = await POST(request(f, { action: "create_agent", agent: { name: "Researcher", role: "Finds sources", systemPrompt: "Cite sources.", supervisorId: f.sender.id, color: "#1767ed" } }));
 assert.equal(response.status, 200);
 const created = (await response.json()).agent;
 assert.equal(created.projectId, f.project.id);
 assert.equal(team.getProjectAgent(f.project.id, created.id, owner)?.systemPrompt, "Cite sources.");
 const childChat = store.getChat(created.chatId, owner)!;
 assert.equal(childChat.projectId, f.project.id);
 assert.equal(childChat.modelId, model);
 assert.equal(childChat.runtimeMode, "approval-required");
 assert.equal(childChat.sessionState?.modeId, "agent");
 const edited = await POST(request(f, { action: "update_agent", agentId: created.id, agent: { name: "Archivist", role: "Archives evidence", supervisorId: null } }));
 assert.equal(edited.status, 200);
 assert.equal((await edited.json()).agent.supervisorId, undefined);
 assert.equal(store.getChat(created.chatId, owner)?.title, "Archivist");
 const active = jobs.enqueueJob({ chatId: created.chatId, userId: owner, message: "Active work", modelId: model });
 const archived = await POST(request(f, { action: "archive_agent", agentId: created.id }));
 assert.equal(archived.status, 200);
 assert.equal(team.getProjectAgent(f.project.id, created.id, owner)?.status, "archived");
 assert.equal(jobs.getJob(active.id)?.status, "cancelled");
 assert.equal(store.getChat(created.chatId, owner)?.archived, true);
 projects.updateProject(f.project.id, { allowAgentManagement: false }, owner);
 assert.equal((await POST(request(f, { action: "update_agent", agentId: f.agents[1].id, agent: { role: "Revoked" } }))).status, 403);
 assert.equal(team.getProjectAgent(f.project.id, f.agents[1].id, owner)?.role, f.agents[1].role);
 stop(f);
});
await t.test("management enforces project scope, worker leases, immutable fields and read-only modes", async () => {
 const f = fixture();
 projects.updateProject(f.project.id, { allowAgentManagement: true }, owner);
 const another = projects.createProject({ ownerId: owner, mode: "agents" });
 const stranger = team.createProjectAgent({ projectId: another.id, ownerId: owner, name: "Other project", role: "Elsewhere" });
 for (const action of ["update_agent", "archive_agent"]) {
  assert.equal((await POST(request(f, { action, agentId: stranger.id, agent: { role: "No" } }))).status, 400);
 }
 assert.equal(team.getProjectAgent(another.id, stranger.id, owner)?.role, "Elsewhere");
 assert.equal((await POST(request(f, { action: "create_agent", agent: { name: "Spoof", role: "No", projectId: another.id } }))).status, 400);
 assert.equal((await POST(request(f, { action: "update_agent", agentId: f.sender.id, agent: { modelId: "invented-model" } }))).status, 400);
 assert.equal((await POST(request(f, { action: "create_agent", agent: { name: "No", role: "No" } }, other))).status, 403);
 const expiredLease = request(f, { action: "create_agent", agent: { name: "No", role: "No" } });
 expiredLease.headers.set("x-ai-chat-lease-token", "stale");
 assert.equal((await POST(expiredLease)).status, 401);
 assert.equal((await POST(request(f, { action: "archive_agent", agentId: f.sender.id }))).status, 400);
 stop(f);
 assert.equal((await POST(request(f, { action: "create_agent", agent: { name: "Stopped", role: "No" } }))).status, 401);
 const plan = fixture("plan");
 projects.updateProject(plan.project.id, { allowAgentManagement: true }, owner);
 assert.equal((await POST(request(plan, { action: "create_agent", agent: { name: "Read-only", role: "No" } }))).status, 403);
 assert.equal((await POST(request(plan, { action: "list" }))).status, 200);
 stop(plan);
});
await t.test("project settings API accepts only booleans from the authenticated project owner", async () => {
 const { authenticateUser } = await import("../lib/auth");
 const { PATCH } = await import("../app/api/projects/[id]/route");
 const f = fixture();
 const session = authenticateUser("team-owner", "test-only-password")!;
 const otherSession = authenticateUser("other-owner", "other-password")!;
 const patch = (value: unknown, token = session.token) => PATCH(new Request("http://test/api/projects/" + f.project.id, {
  method: "PATCH", headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" },
  body: JSON.stringify({ allowAgentManagement: value }),
 }), { params: Promise.resolve({ id: f.project.id }) });
 assert.equal((await patch("true")).status, 400);
 assert.equal(projects.getProject(f.project.id, owner)?.allowAgentManagement, false);
 assert.equal((await patch(true, otherSession.token)).status, 404);
 const enabled = await patch(true);
 assert.equal(enabled.status, 200);
 assert.equal((await enabled.json()).project.allowAgentManagement, true);
 assert.equal((await patch(false)).status, 200);
 assert.equal(projects.getProject(f.project.id, owner)?.allowAgentManagement, false);
 stop(f);
});

});
