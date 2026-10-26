import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = mkdtempSync(path.join(tmpdir(), "metis-chat-projects-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AI_CHAT_ROOT: root, AGENT_CWD: root, AI_CHAT_INTERNAL_ORIGIN: "http://fixture", MCP_BEARER_TOKEN: "synthetic-project-tool-token" });
for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN", "AI_CHAT_TEST_BYPASS_LEASE"]) delete process.env[key];
const modules = Promise.all([import("../lib/sqlite"), import("../lib/db-store"), import("../lib/auth"),
  import("../lib/projects"), import("../lib/project-sharing"), import("../lib/chat-projects"),
  import("../app/api/internal/mcp-chat/route")]);
test.after(async () => { (await modules)[0].getDatabase().close(); rmSync(root, { recursive: true, force: true }); });

test("agent project tools preserve history and enforce the current account, run and project boundaries", async t => {
  const [sqlite, store, auth, projects, sharing, moves, route] = await modules;
  const db = sqlite.getDatabase();
  const owner = auth.createUser("move-owner", "synthetic-password").id;
  const member = auth.createUser("move-member", "synthetic-password").id;
  const stranger = auth.createUser("move-stranger", "synthetic-password").id;
  const project = projects.createProject({ ownerId: owner, name: "Metis" });
  const foreign = projects.createProject({ ownerId: stranger, name: "Other account" });
  const team = projects.createProject({ ownerId: owner, name: "Agents", mode: "agents" });
  const chat = store.createChat("Keep this history", undefined, owner);
  store.appendMessage(chat.id, { role: "user", content: "Develop Metis" }, owner);
  const originalMessages = store.getChat(chat.id, owner)!.messages;
  const jobId = randomUUID(), workerId = randomUUID(), lease = randomUUID(), stamp = new Date().toISOString();
  db.prepare("INSERT INTO jobs (id,chat_id,user_id,data,status,updated_at) VALUES (?,?,?,?,'running',?)").run(jobId, chat.id, owner,
    JSON.stringify({ id: jobId, chatId: chat.id, userId: owner, message: "Develop Metis", status: "running", attempts: 1, createdAt: stamp, updatedAt: stamp }), stamp);
  db.prepare("INSERT INTO job_leases (job_id,worker_id,lease_token,expires_at,updated_at) VALUES (?,?,?,?,?)").run(
    jobId, workerId, lease, new Date(Date.now() + 120_000).toISOString(), stamp);
  const call = (body: unknown, extra: Record<string,string> = {}) => route.POST(new Request("http://fixture/api/internal/mcp-chat", {
    method: "POST", headers: { authorization: "Bearer synthetic-project-tool-token", "content-type": "application/json",
      "x-ai-chat-id": chat.id, "x-ai-chat-user-id": owner, "x-ai-chat-job-id": jobId,
      "x-ai-chat-worker-id": workerId, "x-ai-chat-lease-token": lease, ...extra }, body: JSON.stringify(body),
  }));

  await t.test("listing returns real accessible chat projects", async () => {
    const response = await call({ action: "projects" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.projects.map((p: {id:string}) => p.id), [project.id]);
    assert.equal(body.currentProjectId, null);
    assert.equal(body.projects[0].shared, false);
  });
  await t.test("canonical gateway exposes and forwards both project tools with the active lease", async sub => {
    const { dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
    sub.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/internal/mcp-chat") return route.POST(new Request(url, init));
      return Response.json({ waitingForUser: false });
    });
    const context = { chatId: chat.id, userId: owner, jobId, workerId, leaseToken: lease, runtimeMode: "agent" };
    const listed = await dispatchGatewayTool("list_projects", {}, { auditCall: false, context });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    const moved = await dispatchGatewayTool("move_chat_to_project", { projectId: project.id }, { auditCall: false, context });
    assert.equal(moved.isError, undefined, JSON.stringify(moved));
    assert.equal(store.getChat(chat.id, owner)!.projectId, project.id);
    moves.moveChatToProject(chat.id, null, owner);
  });
  await t.test("moving and removing assignment persist without changing transcript", async () => {
    const moved = await call({ action: "move-project", projectId: project.id });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).projectId, project.id);
    assert.equal(store.getChat(chat.id, owner)!.projectId, project.id);
    assert.deepEqual(store.getChat(chat.id, owner)!.messages, originalMessages);
    assert.equal((await call({ action: "move-project", projectId: null })).status, 200);
    assert.equal(store.getChat(chat.id, owner)!.projectId, undefined);
    assert.deepEqual(store.getChat(chat.id, owner)!.messages, originalMessages);
  });
  await t.test("foreign projects, team projects and malformed IDs are rejected", async () => {
    assert.equal((await call({ action: "move-project", projectId: foreign.id })).status, 404);
    assert.equal((await call({ action: "move-project", projectId: team.id })).status, 400);
    for (const projectId of ["", {}, 12, undefined]) assert.equal((await call({ action: "move-project", projectId })).status, 400);
    assert.equal(store.getChat(chat.id, owner)!.projectId, undefined);
  });
  await t.test("missing identity, changed chat context and expired leases cannot move chats", async () => {
    assert.equal((await call({ action: "projects" }, { "x-ai-chat-user-id": "" })).status, 401);
    const other = store.createChat("Same owner, different run", undefined, owner);
    assert.equal((await call({ action: "move-project", projectId: project.id }, { "x-ai-chat-id": other.id })).status, 403);
    assert.equal((await call({ action: "move-project", projectId: project.id }, { "x-ai-chat-lease-token": "wrong" })).status, 409);
    assert.equal(store.getChat(other.id, owner)!.projectId, undefined);
  });
  await t.test("shared project peers cannot move a chat they did not create", () => {
    const invitation = sharing.inviteProjectMember(project.id, owner, "move-member");
    sharing.respondProjectInvitation(invitation.id, member, "accept");
    const sharedChat = store.createChat("Owner transcript", undefined, owner, undefined, { projectId: project.id });
    const destination = projects.createProject({ ownerId: member, name: "Member project" });
    assert.throws(() => moves.moveChatToProject(sharedChat.id, destination.id, member), /Only the chat creator/);
    assert.equal(store.getChat(sharedChat.id, owner)!.projectId, project.id);
    assert.equal(moves.chatProjectChoices(member).find(p => p.id === project.id)?.shared, true);
  });
  await t.test("Incognito remains outside project organization", () => {
    const privateChat = store.createChat("Private", undefined, owner, undefined, { incognito: true });
    assert.throws(() => moves.moveChatToProject(privateChat.id, project.id, owner), /Private chats/);
    assert.equal(store.getChat(privateChat.id, owner)!.projectId, undefined);
  });
});
