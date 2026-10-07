import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-team-presets-test-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dataDir;
process.env.AGENT_CWD = dataDir;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

test("team preset persistence, review/import boundary and queued AI generation", async t => {
 const [auth, presets, types, team, projects, jobs, store, { getDatabase }] = await Promise.all([
  import("../lib/auth"), import("../lib/team-presets"), import("../lib/team-preset-types"), import("../lib/project-team"), import("../lib/projects"), import("../lib/db-jobs"), import("../lib/db-store"), import("../lib/sqlite"),
 ]);
 after(() => rmSync(dataDir, { recursive: true, force: true }));
 const owner = auth.createUser("preset-owner", "test-only-password").id;
 const other = auth.createUser("preset-other", "test-only-password").id;
 const draft = { name: "Launch team", description: "Launch a product", agents: [
  { key: "lead", name: "Launch Lead", role: "Coordinates launch", color: "#1767ed", systemPrompt: "Coordinate real handoffs." },
  { key: "research", name: "Researcher", role: "Studies the audience", color: "#7324d6", systemPrompt: "Return sourced findings.", supervisorKey: "lead" },
 ] };
 const connectionId = "test-preset-provider";
 const modelId = "openai:" + connectionId + ":discovered-preset-model";
 getDatabase().prepare("INSERT INTO provider_connections(id,owner_id,provider_key,slug,label,auth_type,config,enabled,created_at,updated_at) VALUES (?,?, 'openai','preset-provider','Preset provider','api_key','{}',1,datetime('now'),datetime('now'))").run(connectionId, owner);
 getDatabase().prepare("INSERT INTO provider_models(connection_id,canonical_id,display_name,capabilities,discovered_at) VALUES (?, 'discovered-preset-model','Discovered preset model','{}',datetime('now'))").run(connectionId);
 await t.test("strict JSON validation rejects malformed drafts, cycles and foreign references", () => {
  assert.deepEqual(types.parseTeamDraftResponse("\`\`\`json\n" + JSON.stringify(draft) + "\n\`\`\`"), draft);
  assert.throws(() => types.parseTeamDraftResponse("I created your team"), /invalid team draft/);
  assert.throws(() => types.validateTeamDraft({ ...draft, agents: [] }), /1–32/);
  assert.throws(() => types.validateTeamDraft({ ...draft, agents: [draft.agents[0], draft.agents[0]] }), /unique/);
  assert.throws(() => types.validateTeamDraft({ ...draft, agents: [{ ...draft.agents[0], supervisorKey: "research" }, draft.agents[1]] }), /cycle/);
  assert.throws(() => types.validateTeamDraft({ ...draft, agents: [{ ...draft.agents[0], supervisorKey: "external-id" }] }), /part of this draft/);
  assert.throws(() => types.validateTeamDraft({ ...draft, agents: [{ ...draft.agents[0], color: "red" }] }), /hex/);
  const cleaned = types.validateTeamDraft({ ...draft, agents: [{ ...draft.agents[0], id: "foreign", chatId: "foreign", modelId: "foreign", permissions: "full" }] });
  assert.equal("permissions" in cleaned.agents[0], false);
  assert.equal("modelId" in cleaned.agents[0], false);
 });
 await t.test("saving and editing account presets creates no chats or agents; others cannot read/update/delete", () => {
  const count = () => (getDatabase().prepare("SELECT COUNT(*) count FROM chats").get() as { count: number }).count;
  const before = count(), saved = presets.saveTeamPreset(draft, owner);
  assert.equal(count(), before);
  assert.equal(presets.listTeamPresets(owner).find(p => p.id === saved.id)?.agents[1].supervisorKey, "lead");
  assert.equal(presets.listTeamPresets(other).length, 1);
  assert.throws(() => presets.saveTeamPreset(draft, other, saved.id), /not found/);
  assert.equal(presets.deleteTeamPreset(saved.id, other), false);
  assert.throws(() => presets.listTeamPresets(), /Authenticated/);
  assert.throws(() => presets.saveTeamPreset(draft, owner, "starter"), /not found/);
  const updated = presets.saveTeamPreset({ ...draft, name: "Edited team" }, owner, saved.id);
  assert.equal(updated.id, saved.id);
  assert.equal(updated.createdAt, saved.createdAt);
  assert.equal(presets.listTeamPresets(owner).find(p => p.id === saved.id)?.name, "Edited team");
 });
 await t.test("reviewed import creates fresh stable chats and relationships, preserves existing agents and is atomic", () => {
  const project = projects.createProject({ ownerId: owner, name: "Delivery", mode: "agents" });
  const existing = team.createProjectAgent({ projectId: project.id, ownerId: owner, name: "Existing", role: "Keep" });
  const agents = presets.importTeamDraft(project.id, draft, owner);
  assert.equal(agents.length, 2);
  assert.equal(agents[1].supervisorId, agents[0].id);
  assert.notEqual(agents[0].id, draft.agents[0].key);
  assert.equal(team.listProjectAgents(project.id, owner).length, 3);
  assert.equal(store.getChat(existing.chatId, owner)?.title, "Existing");
  assert.equal(store.getChat(agents[1].chatId, owner)?.messages.length, 0);
  const copy = presets.importTeamDraft(project.id, draft, owner);
  assert.notEqual(copy[0].chatId, agents[0].chatId);
  assert.throws(() => presets.importTeamDraft(project.id, draft, other), /not found/);
  const regular = projects.createProject({ ownerId: owner });
  assert.throws(() => presets.importTeamDraft(regular.id, draft, owner), /regular chats/);
  const before = team.listProjectAgents(project.id, owner).length;
  assert.throws(() => presets.importTeamDraft(project.id, { ...draft, agents: [{ ...draft.agents[0], supervisorKey: "foreign" }] }, owner));
  assert.equal(team.listProjectAgents(project.id, owner).length, before);
  const snapshot = presets.teamDraftFromProject(project.id, owner);
  assert.equal(snapshot.agents.length, before);
  const saved = presets.saveTeamPreset(snapshot, owner);
  assert.ok(presets.deleteTeamPreset(saved.id, owner));
  assert.equal(team.listProjectAgents(project.id, owner).length, before);
 });
 await t.test("import capacity checks and project creation rollback leave no partial team", () => {
  const project = projects.createProject({ ownerId: owner, mode: "agents" });
  for (let i = 0; i < 31; i++) team.createProjectAgent({ projectId: project.id, ownerId: owner, name: "A" + i, role: "R" });
  assert.throws(() => presets.importTeamDraft(project.id, draft, owner), /limit/);
  assert.equal(team.listProjectAgents(project.id, owner).length, 31);
  const before = projects.listProjects(owner).length;
  assert.throws(() => { const db = getDatabase(); db.exec("BEGIN"); try { const p = projects.createProject({ ownerId: owner, mode: "agents" }); presets.importTeamDraft(p.id, { ...draft, agents: [] }, owner); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } });
  assert.equal(projects.listProjects(owner).length, before);
 });
 function record(id: string) { return getDatabase().prepare("SELECT chat_id, job_id, data FROM team_preset_generations WHERE id = ?").get(id) as { chat_id: string; job_id: string; data: string }; }
 await t.test("AI generation uses normal queue, selected discovered model, Ask mode and no import before review", () => {
  assert.throws(() => presets.startTeamGeneration("Team", "openai:" + connectionId + ":invented", owner), /discovered/);
  assert.throws(() => presets.startTeamGeneration("Team", modelId, other), /discovered/);
  const before = (getDatabase().prepare("SELECT COUNT(*) count FROM project_agents").get() as { count: number }).count;
  const generation = presets.startTeamGeneration("A marketing launch team", modelId, owner);
  const r = record(generation.id), job = jobs.getJob(r.job_id)!;
  assert.equal(job.status, "queued"); assert.equal(job.modelId, modelId); assert.equal(job.modeId, "ask");
  assert.equal(store.getChat(r.chat_id, owner)?.archived, true);
  assert.equal(store.getChat(r.chat_id, owner)?.runtimeMode, "approval-required");
  assert.match(job.message, /Return ONLY one JSON object/);
  assert.equal(presets.getTeamGeneration(generation.id, other), null);
  store.appendMessage(r.chat_id, { role: "assistant", content: JSON.stringify(draft) }, owner);
  jobs.updateJob(r.job_id, { status: "completed" });
  assert.deepEqual(presets.getTeamGeneration(generation.id, owner)?.draft, draft);
  assert.equal((getDatabase().prepare("SELECT COUNT(*) count FROM project_agents").get() as { count: number }).count, before);
 });
 await t.test("authenticated routes enforce owner boundaries and reviewed project creation", async () => {
  const [library, item, generate, projectRoute, agentRoute] = await Promise.all([import("../app/api/team-presets/route"), import("../app/api/team-presets/[id]/route"), import("../app/api/team-presets/generate/route"), import("../app/api/projects/route"), import("../app/api/projects/[id]/agents/route")]);
  const session = auth.authenticateUser("preset-owner", "test-only-password")!;
  const otherSession = auth.authenticateUser("preset-other", "test-only-password")!;
  const request = (url: string, body?: unknown, token = session.token, method = body ? "POST" : "GET") => new Request("http://test" + url, { method, headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await library.GET(request("/api/team-presets", undefined, "invalid"))).status, 401);
  const savedResponse = await library.POST(request("/api/team-presets", draft));
  assert.equal(savedResponse.status, 201);
  const saved = (await savedResponse.json()).preset;
  const otherResponse = await library.GET(request("/api/team-presets", undefined, otherSession.token));
  assert.equal((await otherResponse.json()).presets.some((p: { id: string }) => p.id === saved.id), false);
  const params = { params: Promise.resolve({ id: saved.id }) };
  assert.equal((await item.PATCH(request("/api/team-presets/" + saved.id, draft, otherSession.token, "PATCH"), params)).status, 400);
  assert.equal((await item.DELETE(request("/api/team-presets/" + saved.id, undefined, otherSession.token, "DELETE"), params)).status, 404);
  const generation = (await (await generate.POST(request("/api/team-presets/generate", { prompt: "A small team", modelId }))).json()).generation;
  assert.equal((await generate.GET(request("/api/team-presets/generate?id=" + generation.id, undefined, otherSession.token))).status, 404);
  assert.equal((await generate.POST(request("/api/team-presets/generate", { action: "cancel", id: generation.id }, otherSession.token))).status, 404);
  assert.equal((await generate.POST(request("/api/team-presets/generate", { action: "cancel", id: generation.id }))).status, 200);
  const response = await projectRoute.POST(request("/api/projects", { name: "Reviewed launch", mode: "agents", teamDraft: draft }));
  assert.equal(response.status, 201);
  const project = (await response.json()).project;
  const agents = team.listProjectAgents(project.id, owner);
  assert.equal(agents.length, 2); assert.equal(agents[1].supervisorId, agents[0].id);
  assert.equal((await agentRoute.POST(request("/api/projects/" + project.id + "/agents", { draft }, otherSession.token), { params: Promise.resolve({ id: project.id }) })).status, 404);
 });
 await t.test("errors, cancellation, timeout and bounded concurrent generation are traceable", () => {
  const invalid = presets.startTeamGeneration("Invalid JSON", modelId, owner), r = record(invalid.id);
  store.appendMessage(r.chat_id, { role: "assistant", content: "Not JSON" }, owner);
  jobs.updateJob(r.job_id, { status: "completed" });
  assert.equal(presets.getTeamGeneration(invalid.id, owner)?.status, "error");
  const failed = presets.startTeamGeneration("Failure", modelId, owner);
  jobs.updateJob(record(failed.id).job_id, { status: "error", error: "Provider unavailable" });
  assert.match(presets.getTeamGeneration(failed.id, owner)?.error || "", /Provider unavailable/);
  const first = presets.startTeamGeneration("One", modelId, owner), second = presets.startTeamGeneration("Two", modelId, owner);
  assert.throws(() => presets.startTeamGeneration("Three", modelId, owner), /Finish or cancel/);
  assert.equal(presets.cancelTeamGeneration(first.id, other), null);
  assert.equal(presets.cancelTeamGeneration(first.id, owner)?.status, "cancelled");
  const rec = record(second.id), parsed = JSON.parse(rec.data); parsed.createdAt = new Date(Date.now() - 360000).toISOString();
  getDatabase().prepare("UPDATE team_preset_generations SET data = ? WHERE id = ?").run(JSON.stringify(parsed), second.id);
  assert.match(presets.getTeamGeneration(second.id, owner)?.error || "", /timed out/);
  assert.equal(jobs.getJob(rec.job_id)?.status, "cancelled");
 });
});
