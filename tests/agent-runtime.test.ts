import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAgentRuntimeMs } from "../lib/agent-runtime-policy.mjs";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-agent-runtime-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dataDir;
process.env.AGENT_CWD = dataDir;
process.env.MCP_BEARER_TOKEN = "isolated-runtime-test";
process.env.AI_CHAT_WORKER_CONCURRENCY = "8";
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("durable agent limits and scoped cancellation", async t => {
 const [{ createUser }, store, jobs, spawn, state, { armAgentRuntime }] = await Promise.all([
  import("../lib/auth"), import("../lib/db-store"), import("../lib/db-jobs"),
  import("../app/api/internal/mcp-subagent/route"), import("../app/api/internal/mcp-agent-state/route"), import("../lib/agent-runtime"),
 ]);
 const owner = createUser("runtime-owner", "test-password").id;
 const other = createUser("runtime-other", "test-password").id;
 function fixture() {
  const chat = store.createChat("Parent", undefined, owner);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner, message: "Coordinate", maxRuntimeMs: 7_200_000 });
  const parent = jobs.claimNextJob({ workerId: "runtime-worker" })!;
  assert.equal(parent.id, job.id);
  return { chat, parent };
 }
 function request(f: ReturnType<typeof fixture>, body: Record<string, unknown>) {
  return new Request("http://test/api/internal/agent", { method: "POST", headers: {
   authorization: "Bearer isolated-runtime-test", "content-type": "application/json",
   "x-ai-chat-id": f.chat.id, "x-ai-chat-user-id": owner, "x-ai-chat-job-id": f.parent.id,
   "x-ai-chat-worker-id": f.parent.leaseOwner!, "x-ai-chat-lease-token": f.parent.leaseToken!,
  }, body: JSON.stringify(body) });
 }
 function child(f: ReturnType<typeof fixture>, title: string, userId = owner) {
  const chat = store.createChat(title, undefined, userId);
  return jobs.enqueueJob({ chatId: chat.id, userId, message: title, parentJobId: f.parent.id });
 }
 await t.test("normal chats retain their own limits while child jobs share the delegated policy", () => {
  for (const bad of [undefined, NaN, Infinity, "60000"]) assert.equal(normalizeAgentRuntimeMs(bad), 1_800_000);
  assert.equal(normalizeAgentRuntimeMs(0), 1000);
  assert.equal(normalizeAgentRuntimeMs(30_000_000), 21_600_000);
  const f = fixture();
  assert.equal(jobs.getJob(f.parent.id)?.maxRuntimeMs, 7_200_000);
  assert.equal(child(f, "Implicit child").maxRuntimeMs, 1_800_000);
  jobs.requestJobCancel(f.chat.id, owner);
 });
 await t.test("async delegate uses its own default and explicit 6-hour cap, rather than inheriting parent runtime", async () => {
  const f = fixture();
  for (const [timeoutMs, expected] of [[undefined, 1_800_000], [21_600_000, 21_600_000], [43_200_000, 21_600_000]] as const) {
   const response = await spawn.POST(request(f, { title: "Limit " + expected + "-" + timeoutMs, prompt: "Read the assigned scope", wait: false, timeoutMs }));
   assert.equal(response.status, 200);
   const result = await response.json();
   assert.equal(jobs.getJob(result.agentId)?.maxRuntimeMs, expected);
   const duplicate = await spawn.POST(request(f, { title: result.title, prompt: "Read the assigned scope", wait: false }));
   assert.equal((await duplicate.json()).agentId, result.agentId);
   jobs.cancelAgentJob(result.agentId, owner);
  }
  jobs.requestJobCancel(f.chat.id, owner);
 });
 await t.test("stop cancels only the selected subtree, clears waiting forms and stays terminal on repeat", async () => {
  const f = fixture();
  const target = child(f, "Target");
  const sibling = child(f, "Sibling");
  const nestedChat = store.createChat("Nested", undefined, owner);
  const nested = jobs.enqueueJob({ chatId: nestedChat.id, userId: owner, message: "Nested", parentJobId: target.id });
  store.updateChat(target.chatId, { pendingQuestion: { questionId: "waiting" } as never, runStatus: "waiting_input" }, owner);
  store.updateChat(nested.chatId, { pendingApproval: { id: "approval" } as never }, owner);
  const response = await state.POST(request(f, { action: "stop", agentId: target.id }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "cancelled");
  assert.equal(jobs.getJob(nested.id)?.status, "cancelled");
  assert.equal(jobs.getJob(sibling.id)?.status, "queued");
  assert.equal(jobs.getJob(f.parent.id)?.status, "running");
  assert.equal(Boolean(store.getChat(target.chatId, owner)?.pendingQuestion), false);
  assert.equal(Boolean(store.getChat(nested.chatId, owner)?.pendingApproval), false);
  const before = jobs.listRunEvents(target.chatId, owner, 0, target.id).length;
  assert.equal((await state.POST(request(f, { action: "cancel", agentId: target.id }))).status, 200);
  assert.equal(jobs.listRunEvents(target.chatId, owner, 0, target.id).length, before);
  const status = await state.POST(request(f, { action: "status", agentId: target.id }));
  assert.equal((await status.json()).agents[0].status, "cancelled");
  jobs.requestJobCancel(f.chat.id, owner);
 });
 await t.test("children can be addressed, but unrelated runs, foreign owners and parents cannot", async () => {
  const f = fixture();
  const nestedParent = child(f, "Branch");
  const nestedChat = store.createChat("Nested", undefined, owner);
  const nested = jobs.enqueueJob({ chatId: nestedChat.id, userId: owner, message: "nested", parentJobId: nestedParent.id });
  assert.equal((await state.POST(request(f, { action: "cancel", agentId: nested.id }))).status, 200);
  const outsiderChat = store.createChat("Outside", undefined, other);
  const outsider = jobs.enqueueJob({ chatId: outsiderChat.id, userId: other, message: "outside" });
  const sameOwnerChat = store.createChat("Other run", undefined, owner);
  const sameOwner = jobs.enqueueJob({ chatId: sameOwnerChat.id, userId: owner, message: "outside" });
  for (const agentId of [f.parent.id, outsider.id, sameOwner.id]) assert.equal((await state.POST(request(f, { action: "cancel", agentId }))).status, 404);
  assert.equal(jobs.getJob(outsider.id)?.status, "queued");
  assert.equal(jobs.getJob(sameOwner.id)?.status, "queued");
  jobs.cancelAgentJob(outsider.id, other); jobs.cancelAgentJob(sameOwner.id, owner);
  jobs.requestJobCancel(f.chat.id, owner);
 });
 await t.test("job-process deadlines persist across recovery and cancel expired async subtrees", async () => {
  const f = fixture();
  const target = child(f, "Timed subtree");
  const branchChat = store.createChat("Timed descendant", undefined, owner);
  const branch = jobs.enqueueJob({ chatId: branchChat.id, userId: owner, message: "branch", parentJobId: target.id });
  const claimed = jobs.claimNextJob({ workerId: "runtime-worker" })!;
  assert.equal(claimed.id, target.id);
  const release = armAgentRuntime(claimed);
  const deadline = jobs.getJob(target.id)!.agentRuntimeDeadlineAt!;
  assert.ok(Date.parse(deadline) - Date.parse(claimed.claimedAt!) === 1_800_000);
  release();
  jobs.updateJob(target.id, { agentRuntimeDeadlineAt: new Date(Date.now() + 20).toISOString() }, { control: true });
  const releaseResumed = armAgentRuntime(jobs.getJob(target.id)!);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(jobs.getJob(target.id)?.status, "cancelled");
  assert.equal(jobs.getJob(branch.id)?.status, "cancelled");
  assert.equal(jobs.getJob(f.parent.id)?.status, "running");
  releaseResumed(); jobs.requestJobCancel(f.chat.id, owner);
 });
 await t.test("completed child history survives cancellation attempts", async () => {
  const f = fixture();
  const target = child(f, "Completed");
  jobs.updateJob(target.id, { status: "completed" }, { control: true });
  const response = await state.POST(request(f, { action: "cancel", agentId: target.id }));
  const result = await response.json();
  assert.equal(result.status, "completed"); assert.equal(result.cancelled, false);
  jobs.requestJobCancel(f.chat.id, owner);
 });
});
