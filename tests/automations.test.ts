import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-automations-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.MCP_BEARER_TOKEN = "automation-test-token";

const modulesPromise = Promise.all([
  import("../lib/auth"),
  import("../lib/db-store"),
  import("../lib/automations"),
  import("../lib/db-jobs"),
  import("../lib/sqlite"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("automation runs are isolated, durable, tool-capable jobs with long runtime limits", () => {
  const { createUser } = modules[0];
  const { appendMessage, createChat, getChat, listChatsForUser, updateChat } = modules[1];
  const {
    claimDueAutomations,
    createAutomation,
    deleteAutomation,
    finalizeAutomationRunForJob,
    getAutomation,
    queueAutomationRun,
  } = modules[2];
  const { getJob, updateJob } = modules[3];
  const { getDatabase } = modules[4];

  const user = createUser("automation-owner", "test-password");
  const contextChat = createChat("Automation context", {
    tabs: [{ id: "tab-1", title: "Initial", url: "https://example.com" }],
    activeTabId: "tab-1",
    sessionKey: "automation-browser-session",
    updatedAt: new Date().toISOString(),
  }, user.id);

  appendMessage(contextChat.id, { role: "user", content: "Use the existing signed-in browser session for this automation." }, user.id);

  const automation = createAutomation({
    ownerId: user.id,
    chatId: contextChat.id,
    name: "Long browser task",
    prompt: "Use the browser and MCP tools to complete the task.",
    creator: "user",
    maxRunMinutes: 3 * 24 * 60,
    schedule: { kind: "interval", everyMinutes: 60 },
    timezone: "Europe/Berlin",
  });

  assert.equal(automation.modeId, "agent");
  assert.equal(automation.projectId, undefined);
  assert.equal(automation.maxRunMinutes, 4320);
  assert.deepEqual(automation.graph.nodes.map((node) => node.kind), ["trigger", "agent", "tools"]);
  assert.equal(automation.graph.nodes.at(-1)?.config?.browser, true);
  assert.equal(automation.graph.nodes.at(-1)?.config?.mcp, "all");

  const queued = queueAutomationRun(automation, "manual");
  const job = getJob(queued.job.id);
  assert.equal(job?.maxRuntimeMs, 4320 * 60_000);
  assert.equal(job?.modeId, "agent");
  assert.equal(job?.automationId, automation.id);
  assert.match(job?.automationContext || "", /existing signed-in browser session/);

  const runChat = getChat(queued.run.chatId, user.id);
  assert.ok(runChat);
  assert.notEqual(runChat?.id, contextChat.id);
  assert.equal(runChat?.automationId, automation.id);
  assert.equal(runChat?.automationRunId, queued.run.id);
  assert.equal(runChat?.browserContext?.sessionKey, "automation-browser-session");
  assert.equal(runChat?.messages[0]?.content, automation.prompt);

  const normalChatIds = listChatsForUser(user.id).map((chat) => chat.id);
  assert.ok(normalChatIds.includes(contextChat.id));
  assert.ok(!normalChatIds.includes(queued.run.chatId), "run chats stay out of the normal sidebar index");

  // Even if the schedule becomes overdue, a long active run must never be claimed a second time.
  getDatabase().prepare(
    "UPDATE automations SET next_run_at = ?, claimed_at = NULL WHERE id = ?",
  ).run(new Date(Date.now() - 60_000).toISOString(), automation.id);
  assert.equal(claimDueAutomations().some((item) => item.id === automation.id), false);

  updateChat(queued.run.chatId, {
    browserContext: {
      tabs: [{ id: "tab-2", title: "Finished", url: "https://example.com/finished" }],
      activeTabId: "tab-2",
      sessionKey: "automation-browser-session",
      updatedAt: new Date().toISOString(),
    },
  }, user.id);
  appendMessage(queued.run.chatId, { role: "assistant", content: "Task completed with browser + MCP tools." }, user.id);
  updateJob(queued.job.id, { status: "completed" });
  finalizeAutomationRunForJob(queued.job.id);

  const completed = getAutomation(automation.id, user.id);
  assert.equal(completed?.status, "active");
  assert.equal(completed?.runs?.[0]?.status, "completed");
  assert.match(completed?.runs?.[0]?.resultPreview || "", /Task completed/);
  assert.equal(getChat(contextChat.id, user.id)?.browserContext?.activeTabId, "tab-2", "browser state carries forward to the next isolated run");

  assert.equal(deleteAutomation(automation.id, user.id), true);
  assert.equal(getChat(queued.run.chatId, user.id), null, "deleting an automation removes its auxiliary run chats");
  assert.ok(getChat(contextChat.id, user.id), "the user-selected context chat is preserved");
});

test("automation model params persist and are copied onto isolated runs", () => {
  const { createUser } = modules[0];
  const { createChat, getChat } = modules[1];
  const { createAutomation, queueAutomationRun, updateAutomation } = modules[2];
  const { getJob } = modules[3];

  const user = createUser("automation-params-owner", "test-password");
  const contextChat = createChat("Params context", undefined, user.id);
  const automation = createAutomation({
    ownerId: user.id,
    chatId: contextChat.id,
    name: "Reasoning run",
    prompt: "Think carefully.",
    modelId: "gpt-5",
    modelParams: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
    schedule: { kind: "interval", everyMinutes: 60 },
    timezone: "UTC",
  });

  assert.deepEqual(automation.modelParams, [
    { id: "effort", value: "high" },
    { id: "fast", value: "true" },
  ]);
  assert.deepEqual(
    automation.graph.nodes.find((node) => node.kind === "agent")?.config?.modelParams,
    automation.modelParams,
  );

  const queued = queueAutomationRun(automation, "manual");
  const job = getJob(queued.job.id);
  assert.deepEqual(job?.modelParams, automation.modelParams);
  const runChat = getChat(queued.run.chatId, user.id);
  assert.equal(runChat?.modelId, "gpt-5");
  assert.deepEqual(runChat?.modelParams, automation.modelParams);

  const updated = updateAutomation(automation.id, user.id, {
    modelParams: [{ id: "effort", value: "low" }, { id: "fast", value: "false" }],
  });
  assert.deepEqual(updated?.modelParams, [
    { id: "effort", value: "low" },
    { id: "fast", value: "false" },
  ]);
});

test("automation extended model params persist and are copied onto isolated runs", () => {
  const { createUser } = modules[0];
  const { createChat, getChat } = modules[1];
  const { createAutomation, queueAutomationRun, updateAutomation } = modules[2];
  const { getJob } = modules[3];

  const user = createUser("automation-extended-params-owner", "test-password");
  const contextChat = createChat("Extended params context", undefined, user.id);
  const automation = createAutomation({
    ownerId: user.id,
    chatId: contextChat.id,
    name: "Extended reasoning run",
    prompt: "Delegate carefully.",
    modelId: "gpt-5",
    extendedModelId: "gpt-5.4",
    modelParams: [{ id: "effort", value: "medium" }],
    extendedModelParams: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
    schedule: { kind: "interval", everyMinutes: 60 },
    timezone: "UTC",
  });

  assert.deepEqual(automation.extendedModelParams, [
    { id: "effort", value: "high" },
    { id: "fast", value: "true" },
  ]);
  assert.deepEqual(
    automation.graph.nodes.find((node) => node.kind === "agent")?.config?.extendedModelParams,
    automation.extendedModelParams,
  );

  const queued = queueAutomationRun(automation, "manual");
  const job = getJob(queued.job.id);
  assert.equal(job?.extendedModelId, "gpt-5.4");
  assert.deepEqual(job?.extendedModelParams, automation.extendedModelParams);
  const runChat = getChat(queued.run.chatId, user.id);
  assert.equal(runChat?.modelId, "gpt-5");
  assert.deepEqual(runChat?.modelParams, automation.modelParams);

  const updated = updateAutomation(automation.id, user.id, {
    extendedModelParams: [{ id: "effort", value: "low" }, { id: "fast", value: "false" }],
  });
  assert.deepEqual(updated?.extendedModelParams, [
    { id: "effort", value: "low" },
    { id: "fast", value: "false" },
  ]);

  const cleared = updateAutomation(automation.id, user.id, { extendedModelId: "" });
  assert.equal(cleared?.extendedModelId, undefined);
  assert.equal(cleared?.extendedModelParams, undefined);
});

test("destinations enforce ownership, project scope and mandatory active project agents before creating chats", async () => {
  const { createUser } = modules[0];
  const { createChat, getChat, listChatsForUser } = modules[1];
  const { createAutomation, updateAutomation } = modules[2];
  const { createProject } = await import("../lib/projects");
  const { createProjectAgent, archiveProjectAgent } = await import("../lib/project-team");
  const owner = createUser("automation-target-owner", "test-password").id;
  const other = createUser("automation-target-other", "test-password").id;
  const regular = createProject({ ownerId: owner, name: "Regular" });
  const team = createProject({ ownerId: owner, name: "Team", mode: "agents" });
  const agent = createProjectAgent({ projectId: team.id, ownerId: owner, name: "Coordinator", role: "Plans work" });
  const regularChat = createChat("Project context", undefined, owner, undefined, { projectId: regular.id });
  const looseChat = createChat("General context", undefined, owner);
  const foreignChat = createChat("Other account", undefined, other);
  const incognito = createChat("Private", undefined, owner, undefined, { incognito: true });
  const base = { ownerId: owner, name: "Scoped automation", prompt: "Summarize progress", schedule: { kind: "interval" as const, everyMinutes: 60 } };
  const before = listChatsForUser(owner).length;
  assert.throws(() => createAutomation({ ...base, projectId: team.id }), /Select an active agent/);
  assert.throws(() => createAutomation({ ...base, projectId: regular.id, chatId: looseChat.id }), /belong/);
  assert.throws(() => createAutomation({ ...base, projectId: null, chatId: regularChat.id }), /belong/);
  assert.throws(() => createAutomation({ ...base, chatId: foreignChat.id }), /available/);
  assert.throws(() => createAutomation({ ...base, chatId: incognito.id }), /available/);
  assert.throws(() => createAutomation({ ...base, projectId: "missing-project" }), /not found/);
  assert.equal(listChatsForUser(owner).length, before, "invalid destinations must not create orphan chats");
  const fresh = createAutomation({ ...base, projectId: regular.id });
  assert.equal(getChat(fresh.chatId, owner)?.projectId, regular.id);
  const existing = createAutomation({ ...base, projectId: regular.id, chatId: regularChat.id });
  assert.equal(existing.chatId, regularChat.id);
  const inferred = createAutomation({ ...base, chatId: agent.chatId });
  assert.equal(inferred.projectId, team.id, "MCP context-chat calls infer their project");
  assert.throws(() => updateAutomation(existing.id, owner, { projectId: team.id, chatId: "" }), /Select an active agent/);
  const moved = updateAutomation(existing.id, owner, { projectId: team.id, chatId: agent.chatId });
  assert.equal(moved?.chatId, agent.chatId);
  const newContext = updateAutomation(fresh.id, owner, { chatId: "", projectId: null });
  assert.notEqual(newContext?.chatId, fresh.chatId);
  assert.equal(newContext?.projectId, undefined);
  archiveProjectAgent(team.id, agent.id, owner);
  assert.throws(() => createAutomation({ ...base, projectId: team.id, chatId: agent.chatId }), /available|active agent/);
});

test("project automation runs retain context and team identity, reject busy agents atomically, and preserve the agent on deletion", async () => {
  const { createUser } = modules[0];
  const { createChat, getChat, updateChat } = modules[1];
  const { createAutomation, deleteAutomation, queueAutomationRun, finalizeAutomationRunForJob } = modules[2];
  const { enqueueJob, updateJob } = modules[3];
  const { getDatabase } = modules[4];
  const { createProject } = await import("../lib/projects");
  const { createProjectAgent, getProjectAgent, projectTeamContextBlock } = await import("../lib/project-team");
  const owner = createUser("automation-team-run-owner", "test-password").id;
  const regular = createProject({ ownerId: owner, name: "Regular", instructions: "Preserve project decisions" });
  const team = createProject({ ownerId: owner, name: "Team", mode: "agents" });
  const agent = createProjectAgent({ projectId: team.id, ownerId: owner, name: "Researcher", role: "Research", systemPrompt: "Cite sources" });
  const chat = createChat("Regular context", undefined, owner, undefined, { projectId: regular.id });
  const base = { ownerId: owner, name: "Project run", prompt: "Summarize progress", schedule: { kind: "interval" as const, everyMinutes: 60 } };
  const ordinary = createAutomation({ ...base, projectId: regular.id, chatId: chat.id });
  const isolated = queueAutomationRun(ordinary);
  assert.notEqual(isolated.run.chatId, chat.id);
  assert.equal(getChat(isolated.run.chatId, owner)?.projectId, regular.id);
  updateChat(agent.chatId, { runtimeMode: "approval-required" }, owner);
  const automation = createAutomation({ ...base, projectId: team.id, chatId: agent.chatId });
  const busy = enqueueJob({ chatId: agent.chatId, userId: owner, message: "Other work" });
  const before = getChat(agent.chatId, owner)?.messages.length;
  assert.throws(() => queueAutomationRun(automation), /already has an active run/);
  assert.equal(getChat(agent.chatId, owner)?.messages.length, before, "busy rejection must not append a prompt");
  assert.equal((getDatabase().prepare("SELECT count(*) AS n FROM automation_runs WHERE automation_id = ?").get(automation.id) as { n: number }).n, 0);
  updateJob(busy.id, { status: "completed" });
  const run = queueAutomationRun(automation);
  assert.equal(run.run.chatId, agent.chatId);
  assert.equal(run.job.projectTeamId, team.id);
  assert.equal(getChat(agent.chatId, owner)?.runtimeMode, "approval-required");
  assert.match(projectTeamContextBlock(run.job.chatId, owner), /Researcher/);
  assert.match(projectTeamContextBlock(run.job.chatId, owner), /Cite sources/);
  assert.equal(getChat(agent.chatId, owner)?.automationId, undefined, "agent chat is not a disposable automation transcript");
  updateJob(run.job.id, { status: "completed" });
  finalizeAutomationRunForJob(run.job.id);
  assert.equal(deleteAutomation(automation.id, owner), true);
  assert.ok(getChat(agent.chatId, owner));
  assert.ok(getProjectAgent(team.id, agent.id, owner));
});

test("destination API lists only owned chats in the chosen scope and active agents without transcripts", async () => {
  const auth = modules[0];
  const { createChat } = modules[1];
  const { createProject } = await import("../lib/projects");
  const { createProjectAgent, archiveProjectAgent } = await import("../lib/project-team");
  const { GET } = await import("../app/api/automations/targets/route");
  const owner = auth.createUser("automation-target-api", "test-password").id;
  const other = auth.createUser("automation-target-api-other", "test-password").id;
  const token = auth.authenticateUser("automation-target-api", "test-password")!.token;
  const cookie = `ai_chat_auth=${token}`;
  const project = createProject({ ownerId: owner, name: "Normal" });
  const foreign = createProject({ ownerId: other, name: "Foreign" });
  const team = createProject({ ownerId: owner, name: "Team", mode: "agents" });
  const loose = createChat("General", undefined, owner);
  const scoped = createChat("Scoped", undefined, owner, undefined, { projectId: project.id });
  createChat("Foreign chat", undefined, other);
  createChat("Incognito", undefined, owner, undefined, { incognito: true });
  const agent = createProjectAgent({ ownerId: owner, projectId: team.id, name: "Writer", role: "Writes" });
  const archived = createProjectAgent({ ownerId: owner, projectId: team.id, name: "Retired", role: "Old" });
  archiveProjectAgent(team.id, archived.id, owner);
  async function list(id = "") { return GET(new Request(`http://test/api/automations/targets?projectId=${id}`, { headers: { cookie } })); }
  assert.equal((await GET(new Request("http://test/api/automations/targets"))).status, 401);
  assert.deepEqual(await (await list()).json(), { agents: [], chats: [{ id: loose.id, title: "General" }] });
  assert.deepEqual(await (await list(project.id)).json(), { agents: [], chats: [{ id: scoped.id, title: "Scoped" }] });
  assert.deepEqual(await (await list(team.id)).json(), { chats: [], agents: [{ id: agent.id, chatId: agent.chatId, name: "Writer", role: "Writes" }] });
  assert.equal((await list(foreign.id)).status, 404);
});

test("public create and edit APIs enforce the same destination rules and honor a new-chat selection", async () => {
  const auth = modules[0];
  const { createChat, getChat } = modules[1];
  const { createProject } = await import("../lib/projects");
  const { createProjectAgent } = await import("../lib/project-team");
  const { POST } = await import("../app/api/automations/route");
  const { PATCH } = await import("../app/api/automations/[id]/route");
  const owner = auth.createUser("automation-create-api", "test-password").id;
  const token = auth.authenticateUser("automation-create-api", "test-password")!.token;
  const headers = { cookie: `ai_chat_auth=${token}`, "content-type": "application/json" };
  const project = createProject({ ownerId: owner, name: "Project" });
  const team = createProject({ ownerId: owner, name: "Team", mode: "agents" });
  const agent = createProjectAgent({ ownerId: owner, projectId: team.id, name: "Planner", role: "Plans" });
  const chat = createChat("Context", undefined, owner, undefined, { projectId: project.id });
  const body = { name: "API automation", prompt: "Summarize", schedule: { kind: "interval", everyMinutes: 60 } };
  function request(method: string, value: unknown) { return new Request("http://test/api/automations", { method, headers, body: JSON.stringify(value) }); }
  assert.equal((await POST(request("POST", { ...body, projectId: team.id, chatId: "" }))).status, 400);
  const response = await POST(request("POST", { ...body, projectId: project.id, chatId: chat.id }));
  assert.equal(response.status, 201);
  const { automation } = await response.json();
  assert.equal(automation.chatId, chat.id);
  const params = { params: Promise.resolve({ id: automation.id }) };
  const rejected = await PATCH(request("PATCH", { projectId: team.id, chatId: chat.id }), params);
  assert.equal(rejected.status, 400);
  const moved = await PATCH(request("PATCH", { projectId: team.id, chatId: agent.chatId }), params);
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).automation.chatId, agent.chatId);
  const fresh = await PATCH(request("PATCH", { projectId: null, chatId: "" }), params);
  assert.equal(fresh.status, 200);
  const newChat = (await fresh.json()).automation.chatId;
  assert.notEqual(newChat, agent.chatId);
  assert.equal(getChat(newChat, owner)?.projectId, undefined);
});

test("legacy project automations with unassigned context chats keep running with project instructions", async () => {
  const owner = modules[0].createUser("automation-legacy-project", "test-password").id;
  const { createAutomation, getAutomation, queueAutomationRun } = modules[2];
  const { createProject } = await import("../lib/projects");
  const project = createProject({ ownerId: owner, name: "Legacy project" });
  const automation = createAutomation({ ownerId: owner, name: "Old task", prompt: "Summarize", schedule: { kind: "interval", everyMinutes: 60 } });
  modules[4].getDatabase().prepare("UPDATE automations SET project_id = ? WHERE id = ?").run(project.id, automation.id);
  const legacy = getAutomation(automation.id, owner)!;
  const run = queueAutomationRun(legacy);
  assert.equal(modules[1].getChat(run.run.chatId, owner)?.projectId, project.id);
  assert.equal(modules[1].getChat(automation.chatId, owner)?.projectId, undefined);
});
