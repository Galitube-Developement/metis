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

});
