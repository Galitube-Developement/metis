import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const directory = mkdtempSync(path.join(os.tmpdir(), "metis-project-default-"));
Object.assign(process.env, { CHAT_DATA_DIR: directory, CHAT_DB_PATH: path.join(directory, "chat.sqlite"), AI_CHAT_ROOT: directory, AGENT_CWD: directory, MCP_BEARER_TOKEN: "isolated-default-agent-test" });
after(() => rmSync(directory, { recursive: true, force: true }));

test("project default agent governs persistence, execution and API changes", async t => {
  const [projects, store, team, jobs, auth, projectApi, projectDetail, chatApi, modesApi, policy, prompt, support] = await Promise.all([
    import("../lib/projects"), import("../lib/db-store"), import("../lib/project-team"),
    import("../lib/db-jobs"), import("../lib/auth"), import("../app/api/projects/route"),
    import("../app/api/projects/[id]/route"), import("../app/api/chats/[id]/route"),
    import("../app/api/modes/route"), import("../lib/project-agent-mode-server"),
    import("../lib/providers/prompt-context"), import("../lib/providers/adapters/provider-support"),
  ]);
  const owner = auth.createUser("project-mode-owner", "test-password").id;
  const stranger = auth.createUser("project-mode-stranger", "test-password").id;
  const custom = { id: "auditor", name: "Auditor", description: "Review without editing", icon: "search", instructions: "AUDITOR_INSTRUCTIONS", allowedCategories: ["read" as const], toolOverrides: { execute_command: false } };
  store.saveGlobalModelSettings({ ...store.getGlobalModelSettings(owner), customModes: [custom] }, owner);
  store.saveGlobalModelSettings({ ...store.getGlobalModelSettings(stranger), customModes: [{ ...custom, id: "other-owner-agent" }] }, stranger);
  const cookie = "ai_chat_auth=" + auth.authenticateUser("project-mode-owner", "test-password")!.token;
  const request = (method: string, body?: unknown, url = "http://test/api/projects") => new Request(url, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let project: ReturnType<typeof projects.createProject>;
  let agent: ReturnType<typeof team.createProjectAgent>;

  await t.test("creation accepts built-in and owned custom profiles only for agent projects", async () => {
    const result = await projectApi.POST(request("POST", { name: "Review team", mode: "agents", defaultModeId: custom.id }));
    assert.equal(result.status, 201);
    project = (await result.json()).project;
    assert.equal(project.defaultModeId, custom.id);
    assert.equal(projects.getProject(project.id, owner)?.defaultModeId, custom.id);
    agent = team.createProjectAgent({ projectId: project.id, ownerId: owner, name: "Reviewer", role: "Reviews changes" });
    assert.equal(store.getChat(agent.chatId, owner)?.sessionState?.modeId, custom.id);
    const legacy = projects.createProject({ mode: "agents", ownerId: owner });
    assert.equal(legacy.defaultModeId, "agent");
    const regular = projects.createProject({ ownerId: owner, defaultModeId: custom.id });
    assert.equal(regular.defaultModeId, undefined);
    assert.throws(() => projects.updateProject(regular.id, { defaultModeId: "ask" }, owner), /only available/);
    for (const defaultModeId of ["other-owner-agent", "missing", null, 1]) {
      const invalid = await projectApi.POST(request("POST", { mode: "agents", defaultModeId }));
      assert.equal(invalid.status, 400);
    }
  });
  await t.test("chat PATCH cannot override the project agent or lose composer state", async () => {
    const result = await chatApi.PATCH(request("PATCH", { sessionState: { modeId: "agent", input: "Keep this draft" } }), { params: Promise.resolve({ id: agent.chatId }) });
    assert.equal(result.status, 200);
    assert.equal(store.getChat(agent.chatId, owner)?.sessionState?.modeId, custom.id);
    assert.equal(store.getChat(agent.chatId, owner)?.sessionState?.input, "Keep this draft");
    store.updateChat(agent.chatId, { sessionState: null }, owner);
    assert.equal(store.getChat(agent.chatId, owner)?.sessionState?.modeId, custom.id);
  });
  await t.test("queue, prompt and tool permissions use the default instead of an incoming override", async () => {
    const job = jobs.enqueueJob({ chatId: agent.chatId, userId: owner, message: "Review", modeId: "agent" });
    assert.equal(job.modeId, custom.id);
    const chat = store.getChat(agent.chatId, owner)!;
    const mode = policy.projectModeForChat(chat, "agent", [custom]);
    assert.equal(mode.id, custom.id);
    assert.deepEqual(mode.allowedCategories, ["read"]);
    assert.match(prompt.buildProviderPrompt({ job: { ...job, modeId: "agent" } }), /AUDITOR_INSTRUCTIONS/);
    const context = { job: { ...job, modeId: "agent" }, chat } as never;
    assert.deepEqual(support.providerRemoteTools(context), {});
    const mcp = support.providerMcpContext(context);
    assert.equal(mcp.modeId, custom.id);
    assert.deepEqual(JSON.parse(mcp.modePolicy!).allowedCategories, ["read"]);
    assert.equal(policy.projectModeOverride(project.id, stranger), null);
    const claimed = jobs.claimNextJob({ workerId: "project-default-test-worker" })!;
    const modeApi = await import("../app/api/internal/mcp-mode/route");
    const response = await modeApi.POST(new Request("http://test/api/internal/mcp-mode", {
      method: "POST", headers: { authorization: "Bearer isolated-default-agent-test", "content-type": "application/json",
        "x-ai-chat-job-id": claimed.id, "x-ai-chat-id": agent.chatId, "x-ai-chat-user-id": owner,
        "x-ai-chat-worker-id": claimed.leaseOwner!, "x-ai-chat-lease-token": claimed.leaseToken! },
      body: JSON.stringify({ modeId: "agent" }),
    }));
    assert.equal(response.status, 409);
    assert.equal(store.getChat(agent.chatId, owner)?.sessionState?.modeId, custom.id);
    jobs.requestJobCancel(agent.chatId, owner);
  });
  await t.test("changing the project default updates existing chats and subsequent runs", async () => {
    const result = await projectDetail.PATCH(request("PATCH", { defaultModeId: "plan" }), { params: Promise.resolve({ id: project.id }) });
    assert.equal(result.status, 200);
    assert.equal(store.getChat(agent.chatId, owner)?.sessionState?.modeId, "plan");
    const job = jobs.enqueueJob({ chatId: agent.chatId, userId: owner, message: "Plan", modeId: "agent" });
    assert.equal(job.modeId, "plan");
    jobs.requestJobCancel(agent.chatId, owner);
    const newer = team.createProjectAgent({ projectId: project.id, ownerId: owner, name: "Planner", role: "Plans work" });
    assert.equal(store.getChat(newer.chatId, owner)?.sessionState?.modeId, "plan");
    const invalid = await projectDetail.PATCH(request("PATCH", { defaultModeId: {} }), { params: Promise.resolve({ id: project.id }) });
    assert.equal(invalid.status, 400);
    assert.equal(projects.getProject(project.id, owner)?.defaultModeId, "plan");
  });
  await t.test("regular chats keep individual selection and project defaults cannot be deleted", async () => {
    const regular = projects.createProject({ ownerId: owner });
    const chat = store.createChat("Regular", undefined, owner, undefined, { projectId: regular.id });
    store.updateChat(chat.id, { sessionState: { modeId: "ask" } }, owner);
    assert.equal(store.getChat(chat.id, owner)?.sessionState?.modeId, "ask");
    const job = jobs.enqueueJob({ chatId: chat.id, userId: owner, message: "Question", modeId: "ask" });
    assert.equal(job.modeId, "ask");
    jobs.requestJobCancel(chat.id, owner);
    projects.updateProject(project.id, { defaultModeId: custom.id }, owner);
    const blocked = await modesApi.DELETE(request("DELETE", undefined, "http://test/api/modes?id=auditor"));
    assert.equal(blocked.status, 409);
    assert.equal(store.getGlobalModelSettings(owner).customModes?.length, 1);
    projects.updateProject(project.id, { defaultModeId: "agent" }, owner);
    const deleted = await modesApi.DELETE(request("DELETE", undefined, "http://test/api/modes?id=auditor"));
    assert.equal(deleted.status, 200);
  });
});
