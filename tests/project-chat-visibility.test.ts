import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { filterProjectChats } from "../lib/project-chat-visibility";

const chats = [
 { id: "free" }, { id: "a", projectId: "hidden" }, { id: "pinned", projectId: "hidden", pinned: true },
 { id: "b", projectId: "visible" }, { id: "old", projectId: "hidden", archived: true },
 { id: "missing-project", projectId: "unknown" },
];
const projects = [{ id: "hidden", hideChatsFromAll: true }, { id: "visible" }];

test("All hides project chats including pinned ones while preserving unrelated and unassigned chats", () => {
 assert.deepEqual(filterProjectChats(chats, projects, null).map(chat => chat.id), ["free", "b", "missing-project"]);
});
test("Selecting a hidden project restores its chats while archived chats remain excluded", () => {
 assert.deepEqual(filterProjectChats(chats, projects, "hidden").map(chat => chat.id), ["a", "pinned"]);
 assert.deepEqual(filterProjectChats(chats, projects, "visible").map(chat => chat.id), ["b"]);
});
test("Turning visibility back on immediately restores all non-archived project chats without mutating the list", () => {
 assert.deepEqual(filterProjectChats(chats, [{ id: "hidden", hideChatsFromAll: false }]).map(chat => chat.id), ["free", "a", "pinned", "b", "missing-project"]);
 assert.equal(chats.length, 6);
});
test("An All view can be empty even when a hidden project still contains chats", () => {
 const onlyHidden = [{ id: "a", projectId: "hidden" }];
 assert.deepEqual(filterProjectChats(onlyHidden, projects), []);
 assert.equal(filterProjectChats(onlyHidden, projects, "hidden").length, 1);
});

test("Project chat visibility persists with account isolation and validated HTTP updates", async t => {
 const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-project-chat-visibility-"));
 process.env.CHAT_DATA_DIR = dataDir;
 process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
 process.env.AI_CHAT_ROOT = dataDir;
 process.env.AGENT_CWD = dataDir;
 delete process.env.AI_CHAT_USER_ID;
 delete process.env.AI_CHAT_JOB_ID;
 const [auth, projectStore, { getDatabase }, { PATCH }] = await Promise.all([
  import("../lib/auth"), import("../lib/projects"), import("../lib/sqlite"), import("../app/api/projects/[id]/route"),
 ]);
 after(() => rmSync(dataDir, { recursive: true, force: true }));
 const owner = auth.createUser("visibility-owner", "test-only-password").id;
 const other = auth.createUser("visibility-other", "test-only-password").id;
 const session = auth.authenticateUser("visibility-owner", "test-only-password")!;
 const foreignSession = auth.authenticateUser("visibility-other", "test-only-password")!;
 const request = (id: string, value: unknown, token = session.token) => PATCH(new Request("http://test/api/projects/" + id, {
  method: "PATCH", headers: { "content-type": "application/json", cookie: auth.CHAT_COOKIE + "=" + token },
  body: JSON.stringify({ hideChatsFromAll: value }),
 }), { params: Promise.resolve({ id }) });
 await t.test("Chat and agent projects default visible and retain the flag through unrelated edits", () => {
  for (const mode of ["chat", "agents"] as const) {
   const project = projectStore.createProject({ ownerId: owner, mode });
   assert.equal(project.hideChatsFromAll, false);
   assert.equal(projectStore.updateProject(project.id, { hideChatsFromAll: true }, owner)?.hideChatsFromAll, true);
   projectStore.updateProject(project.id, { name: "Renamed" }, owner);
   assert.equal(projectStore.getProject(project.id, owner)?.hideChatsFromAll, true);
   assert.equal(projectStore.listProjects(owner).find(p => p.id === project.id)?.hideChatsFromAll, true);
   assert.equal(projectStore.updateProject(project.id, { hideChatsFromAll: false }, owner)?.hideChatsFromAll, false);
  }
 });
 await t.test("Legacy and malformed stored values do not hide chats", () => {
  const project = projectStore.createProject({ ownerId: owner });
  getDatabase().prepare("UPDATE projects SET data = json_remove(data, '$.hideChatsFromAll') WHERE id = ?").run(project.id);
  assert.equal(projectStore.getProject(project.id, owner)?.hideChatsFromAll, false);
  getDatabase().prepare("UPDATE projects SET data = json_set(data, '$.hideChatsFromAll', 'true') WHERE id = ?").run(project.id);
  assert.equal(projectStore.getProject(project.id, owner)?.hideChatsFromAll, false);
 });
 await t.test("The HTTP switch accepts booleans, rejects malformed values and cannot change another account", async () => {
  const project = projectStore.createProject({ ownerId: owner });
  const response = await request(project.id, true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).project.hideChatsFromAll, true);
  for (const value of ["true", 1, null, {}]) assert.equal((await request(project.id, value)).status, 400);
  assert.equal((await request(project.id, false, foreignSession.token)).status, 404);
  assert.equal(projectStore.updateProject(project.id, { hideChatsFromAll: false }, other), null);
  assert.equal(projectStore.getProject(project.id, owner)?.hideChatsFromAll, true);
  assert.equal((await request(project.id, false)).status, 200);
  assert.equal(projectStore.getProject(project.id, owner)?.hideChatsFromAll, false);
 });
});
