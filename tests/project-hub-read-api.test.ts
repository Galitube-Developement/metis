import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-hub-read-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AGENT_CWD: dir, AI_CHAT_ROOT: dir });
test.after(() => rmSync(dir, { recursive: true, force: true }));
test("project hub GET preserves account boundaries and returns JSON for query failures", async t => {
  const [api, auth, projects, sqlite, client] = await Promise.all([
    import("../app/api/projects/[id]/route"), import("../lib/auth"), import("../lib/projects"), import("../lib/sqlite"), import("../lib/project-home-client")
  ]);
  const owner = auth.createUser("hub-owner", "test-password"); auth.createUser("hub-other", "test-password");
  const cookie = "ai_chat_auth=" + auth.authenticateUser("hub-owner", "test-password")!.token;
  const other = "ai_chat_auth=" + auth.authenticateUser("hub-other", "test-password")!.token;
  const project = projects.createProject({ ownerId: owner.id, mode: "agents", name: "Hub" });
  const get = (credential?: string) => api.GET(new Request("http://test/api/projects/" + project.id, { headers: credential ? { cookie: credential } : {} }), { params: Promise.resolve({ id: project.id }) });
  for (const [credential, status] of [[undefined, 401], [other, 404], [cookie, 200]] as const) {
    const result = await get(credential); assert.equal(result.status, status); assert.match(result.headers.get("content-type")!, /application\/json/);
  }
  t.mock.method(globalThis, "fetch", async () => get(cookie));
  assert.equal((await client.fetchProjectHome(project.id)).project.id, project.id);
  const db = sqlite.getDatabase(), prepare = db.prepare;
  t.mock.method(db, "prepare", function(this: typeof db, sql: string) {
    if (sql.includes("SELECT data FROM project_files")) throw new Error("Simulated hub query failure");
    return prepare.call(this, sql);
  });
  const failed = await get(cookie);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Could not load your project. Try again." });
  t.mock.restoreAll();
  assert.equal((await get(cookie)).status, 200);
});
