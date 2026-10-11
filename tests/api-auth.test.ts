import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

test("shared admin guard preserves authenticated owner, 401 and 403 in both user routes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-api-auth-"));
  Object.assign(process.env, {
    AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root,
    CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"),
    METIS_AI_BOOTSTRAP_PASSWORD: "", METIS_AI_ADMIN_USERNAMES: "", CHAT_LEGACY_HEADER_AUTH: "false",
  });
  const { getDatabase } = await import("../lib/sqlite");
  const db = getDatabase();
  try {
    for (const [id, admin] of [["admin", 1], ["reader", 0]] as const) {
      db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)")
        .run(id, id, "test-only", new Date().toISOString(), admin);
      db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
        .run(createHash("sha256").update(id).digest("hex"), id, new Date(Date.now() + 60_000).toISOString());
    }
    const { requireHostAdmin } = await import("../lib/api-auth");
    const collection = await import("../app/api/admin/users/route");
    const member = await import("../app/api/admin/users/[id]/route");
    const req = (token?: string) => new Request("http://localhost/api/admin/users", {
      headers: token ? { cookie: "ai_chat_auth=" + token } : {},
    });
    assert.deepEqual(await requireHostAdmin(req("admin")), { userId: "admin" });
    for (const [token, status] of [[undefined, 401], ["invalid", 401], ["reader", 403]] as const) {
      const result = await requireHostAdmin(req(token));
      assert.equal(result.error?.status, status);
      assert.equal((await collection.GET(req(token))).status, status);
      assert.equal((await collection.POST(req(token))).status, status);
      assert.equal((await member.PATCH(req(token), { params: Promise.resolve({ id: "admin" }) })).status, status);
      assert.equal((await member.DELETE(req(token), { params: Promise.resolve({ id: "admin" }) })).status, status);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
