import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-runtime-settings-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dataDir;
process.env.AGENT_CWD = dataDir;
delete process.env.CHAT_LEGACY_HEADER_AUTH;
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("runtime settings authenticate, isolate accounts, validate and preserve other preferences", async () => {
  const [auth, store, api] = await Promise.all([import("../lib/auth"), import("../lib/db-store"), import("../app/api/agent-settings/route")]);
  const owner = auth.createUser("runtime-preference-owner", "test-password");
  const other = auth.createUser("runtime-preference-other", "test-password");
  const session = auth.authenticateUser(owner.username, "test-password")!;
  function request(body?: unknown, authenticated = true) {
    return new Request("http://test/api/agent-settings", {
      method: body === undefined ? "GET" : "PATCH",
      headers: { "content-type": "application/json", ...(authenticated ? { cookie: "ai_chat_auth=" + session.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  store.saveGlobalModelSettings({ agentRules: [{ id: "rule", content: "Preserve me" }], modelId: "existing-selection" }, owner.id);
  assert.equal((await api.GET(request(undefined, false))).status, 401);
  assert.equal((await api.PATCH(request({ runtimeMs: 3_600_000 }, false))).status, 401);
  const defaults = await (await api.GET(request())).json();
  assert.equal(defaults.runtimeMs, 1_800_000);
  assert.equal(defaults.minRuntimeMs, 900_000);
  assert.equal(defaults.maxRuntimeMs, null);
  assert.equal(defaults.unlimitedRuntimeMs, 0);
  for (const runtimeMs of [null, "3600000", -60_000, 60_001, 30_000, 840_000, 900_001, 60_000.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await api.PATCH(request({ runtimeMs }))).status, 400);
  }
  for (const runtimeMs of [900_000, 3_600_000, 43_200_000, 30 * 24 * 60 * 60_000, 0]) {
    const response = await api.PATCH(request({ runtimeMs, ownerId: other.id }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).runtimeMs, runtimeMs);
    assert.equal((await (await api.GET(request())).json()).runtimeMs, runtimeMs);
    assert.equal(store.getGlobalModelSettings(owner.id).agentRuntimeMs, runtimeMs);
    assert.equal(store.getGlobalModelSettings(other.id).agentRuntimeMs, undefined);
    assert.equal(store.getGlobalModelSettings(owner.id).modelId, "existing-selection");
    assert.equal(store.getGlobalModelSettings(owner.id).agentRules?.[0].content, "Preserve me");
  }
  const malformed = new Request("http://test/api/agent-settings", { method: "PATCH", headers: { cookie: "ai_chat_auth=" + session.token }, body: "{" });
  assert.equal((await api.PATCH(malformed)).status, 400);
});
