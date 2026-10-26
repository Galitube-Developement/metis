import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-retry-settings-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AI_CHAT_ROOT: dir, AGENT_CWD: dir });
after(() => rmSync(dir, { recursive: true, force: true }));

test("authenticated retry setting defaults OFF, validates input, persists and isolates accounts", async () => {
  const auth = await import("../lib/auth");
  const route = await import("../app/api/agent-settings/provider-retry/route");
  const settings = await import("../lib/provider-retry-settings");
  const a = auth.createUser("retry-owner-a", "fixture-password");
  const b = auth.createUser("retry-owner-b", "fixture-password");
  const session = auth.authenticateUser("retry-owner-a", "fixture-password")!;
  const req = (body?: unknown) => new Request("http://localhost/api/agent-settings/provider-retry", {
    method: body === undefined ? "GET" : "PATCH",
    headers: { cookie: `ai_chat_auth=${session.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await route.GET(new Request("http://localhost/api/agent-settings/provider-retry"))).status, 401);
  assert.equal((await route.PATCH(new Request("http://localhost/api/agent-settings/provider-retry", { method: "PATCH", body: "{}" }))).status, 401);
  const initial = await route.GET(req());
  assert.match(initial.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await initial.json(), { enabled: false, defaultEnabled: false });
  assert.equal((await route.PATCH(req({ enabled: "true" }))).status, 400);
  assert.equal((await route.PATCH(req({ enabled: true }))).status, 200);
  assert.equal(settings.getProviderRetryEnabled(a.id), true);
  assert.equal(settings.getProviderRetryEnabled(b.id), false);
  assert.equal((await (await route.GET(req())).json()).enabled, true);
  assert.equal((await route.PATCH(req({ enabled: false }))).status, 200);
  assert.equal(settings.getProviderRetryEnabled(a.id), false);
});
