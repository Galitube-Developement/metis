import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const data = mkdtempSync(path.join(os.tmpdir(), "metis-auth-security-"));
process.env.CHAT_DATA_DIR = data;
process.env.CHAT_DB_PATH = path.join(data, "chat.sqlite");
process.env.AI_CHAT_ROOT = data;
process.env.AGENT_CWD = data;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
delete process.env.CHAT_LEGACY_HEADER_AUTH;
delete process.env.CHAT_PASSWORD;

after(async () => {
  const { getDatabase } = await import("../lib/sqlite");
  getDatabase().close();
  rmSync(data, { recursive: true, force: true });
});
function login(username: string, password = "incorrect", headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ username, password }),
  });
}

test("rotating caller-controlled IP headers still reaches the username login limit", async () => {
  const { POST } = await import("../app/api/auth/route");
  for (let index = 0; index < 12; index++) {
    const response = await POST(login("rotating-header-account", "incorrect", {
      "x-real-ip": "198.51.100." + index, "x-forwarded-for": "203.0.113." + index,
      "x-metis-network": "forged.metadata",
    }));
    assert.equal(response.status, index < 10 ? 401 : 429);
    if (index >= 10) assert.ok(Number(response.headers.get("retry-after")) > 0);
  }
});

test("logout revokes the server-side session and login rotates the presented session", async () => {
  const auth = await import("../lib/auth");
  const { POST, DELETE } = await import("../app/api/auth/route");
  const { resetRateLimit } = await import("../lib/rate-limit");
  resetRateLimit("auth:ip:unknown");
  const user = auth.createUser("session-security-user", "synthetic-password-123");
  const first = auth.authenticateUser(user.username, "synthetic-password-123")!;
  const another = auth.authenticateUser(user.username, "synthetic-password-123")!;
  const request = (token: string) => new Request("http://localhost/api/auth", { headers: { cookie: "ai_chat_auth=" + token } });
  assert.equal(await auth.getAuthenticatedUserId(request(first.token)), user.id);
  assert.equal((await DELETE(request(first.token))).status, 200);
  assert.equal(await auth.getAuthenticatedUserId(request(first.token)), null);
  assert.equal(await auth.getAuthenticatedUserId(request(another.token)), user.id);
  assert.equal((await DELETE(request(first.token))).status, 200); // idempotent
  const response = await POST(login(user.username, "synthetic-password-123", { cookie: "ai_chat_auth=" + another.token, "x-forwarded-proto": "https" }));
  assert.equal(response.status, 200);
  assert.equal(await auth.getAuthenticatedUserId(request(another.token)), null);
  const token = response.headers.get("set-cookie")!.match(/ai_chat_auth=([^;]+)/)![1];
  assert.notEqual(token, another.token);
  assert.equal(await auth.getAuthenticatedUserId(request(token)), user.id);
  assert.doesNotMatch(response.headers.get("set-cookie")!, /;\s*Secure/i); // forged HTTPS ignored
});

test("password changes revoke every server-side session", async () => {
  const auth = await import("../lib/auth");
  const { patchManagedUser } = await import("../lib/admin-users");
  const user = auth.createUser("password-session-user", "synthetic-old-password");
  const first = auth.authenticateUser(user.username, "synthetic-old-password")!;
  const second = auth.authenticateUser(user.username, "synthetic-old-password")!;
  patchManagedUser(user.id, { password: "synthetic-new-password" });
  for (const session of [first, second]) {
    assert.equal(await auth.getAuthenticatedUserId(new Request("http://localhost", {
      headers: { cookie: "ai_chat_auth=" + session.token },
    })), null);
  }
  assert.equal(auth.authenticateUser(user.username, "synthetic-old-password"), null);
  assert.ok(auth.authenticateUser(user.username, "synthetic-new-password"));
});

test("malformed credentials fail with 400 before password hashing", async () => {
  const { POST } = await import("../app/api/auth/route");
  for (const body of [null, { username: [], password: "a" }, { username: "a", password: {} }, { password: "a".repeat(4097) }]) {
    const response = await POST(new Request("http://localhost/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
  }
});

test("unused public LLM generation route is removed", () => {
  assert.equal(existsSync(path.join(import.meta.dirname, "../app/api/process-a/route.ts")), false);
});
