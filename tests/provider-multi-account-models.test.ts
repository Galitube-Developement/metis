import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const sdk = createRequire(import.meta.url)("@cursor/sdk") as typeof import("@cursor/sdk");

const root = mkdtempSync(path.join(os.tmpdir(), "metis-multi-account-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root,
  CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root,
  AI_CHAT_SECRETS_KEY: "ab".repeat(32), CHAT_PASSWORD: "",
  METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
});
const imports = Promise.all([
  import("../lib/auth"), import("../lib/provider-connections"),
  import("../lib/providers/discovery"), import("../app/api/models/route"),
  import("../lib/providers/types"), Promise.resolve(sdk),
  import("../lib/model-access"), import("../lib/sqlite"),
]);
let modules: Awaited<typeof imports>;
let owner: string, foreign: string, token: string;
let first: string, second: string, foreignConnection: string, disabled: string;
let otherA: string, otherB: string;
let failingKey = "";
const calls: string[] = [];
const shared = "fixture-shared-model";
before(async () => {
  modules = await imports;
  const [auth, connections, discovery, , , sdk] = modules;
  mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network in isolated fixture"); });
  owner = auth.createUser("multi-owner", "fixture-password").id;
  foreign = auth.createUser("multi-foreign", "fixture-password").id;
  token = auth.authenticateUser("multi-owner", "fixture-password")!.token;
  modules[6].ensureAllModelAccess(owner);
  const add = (user: string, slug: string, providerKey = "cursor", enabled = true) =>
    connections.upsertProviderConnection(user, {
      providerKey, slug, label: slug, authType: "api_key",
      secret: slug + "-key", enabled,
    })!.id;
  first = add(owner, "cursor-a");
  second = add(owner, "cursor-b");
  foreignConnection = add(foreign, "foreign-cursor");
  disabled = add(owner, "disabled-cursor", "cursor", false);
  add(owner, "empty-cursor");
  connections.updateProviderConnection(
    connections.listProviderConnections(owner).find(c => c.slug === "empty-cursor")!.id,
    owner, { clearSecret: true },
  );
  otherA = add(owner, "compatible-a", "compatible");
  otherB = add(owner, "compatible-b", "compatible");
  for (const id of [otherA, otherB]) discovery.persistDiscoveredModels(id, [
    { id: shared, displayName: "Compatible fixture", contextWindow: 123456, contextWindowDiscovered: true },
  ]);
  mock.method(sdk.Cursor.models, "list", async ({ apiKey }: { apiKey: string }) => {
    calls.push(apiKey);
    assert.ok(["cursor-a-key", "cursor-b-key"].includes(apiKey), "only owner's enabled credentials may reach discovery");
    if (apiKey === failingKey) throw new Error("fixture discovery unavailable");
    const contextWindow = apiKey === "cursor-a-key" ? 234567 : 345678;
    return [{
      id: shared, displayName: "Live " + apiKey, contextWindow,
      parameters: [{ id: "effort", values: [{ value: "fixture-effort" }] }],
      variants: [{ isDefault: true, params: [{ id: "effort", value: "fixture-effort" }] }],
    }];
  });
});
after(() => { mock.restoreAll(); rmSync(root, { recursive: true, force: true }); });

test("real Cursor runner uses selected account, fresh secrets and native model ID at SDK boundary", async t => {
  // Replace only MCP configuration assembly in the CJS dependency cache.
  // The worker, DB, permissions and credential resolver run unchanged.
  const require = createRequire(import.meta.url);
  const mcpPath = require.resolve("../lib/mcp");
  const mcp = require(mcpPath);
  const cached = require.cache[mcpPath]!;
  const original = cached.exports;
  cached.exports = { ...mcp, getMcpServers: () => ({}) };
  t.after(() => { cached.exports = original; });
  const [store, jobs, runner] = await Promise.all([
    import("../lib/db-store"), import("../lib/db-jobs"),
    import("../lib/worker-runner"),
  ]);
  mkdirSync(path.join(root, "agent-traces"), { recursive: true });
  // Stop at SDK initialization: no session or paid turn is created.
  const captured: Array<{ apiKey?: string; model?: { id: string } }> = [];
  t.mock.method(sdk.Agent, "create", async (options: (typeof captured)[number]) => {
    captured.push(options);
    throw new Error("fixture SDK boundary stop");
  });
  t.mock.method(sdk.Agent, "resume", async () => {
    throw new Error("unexpected cross-account legacy session resume");
  });
  const run = async (modelId: string, legacyAgent = false) => {
    const chat = store.createChat("Runner fixture", undefined, owner, { id: modelId });
    if (legacyAgent) store.updateChat(chat.id, { agentId: "legacy-other-account" }, owner);
    const job = jobs.enqueueJob({ chatId: chat.id, userId: owner, modelId, message: "fixture", incognito: true });
    await runner.runQueuedJob(job);
    assert.match(jobs.getJob(job.id)?.error || "", /fixture SDK boundary stop|not available|No enabled Cursor/);
  };
  await run("cursor:" + first + ":" + shared, true);
  await run("cursor:" + second + ":" + shared);
  modules[1].updateProviderConnection(second, owner, { secret: "rotated-key" });
  try {
    await run("cursor:" + second + ":" + shared);
    const active = modules[1].findActiveConnection(owner, "cursor")!;
    const expectedLegacyKey = modules[1].getProviderConnectionSecret(active.id, owner)!.secret;
    await run(shared);
    assert.deepEqual(captured.map(c => c.apiKey), [
      "cursor-a-key", "cursor-b-key", "rotated-key", expectedLegacyKey,
    ]);
    assert.deepEqual(captured.map(c => c.model?.id), [shared, shared, shared, shared]);
    const beforeRejected = captured.length;
    for (const id of [foreignConnection, disabled, "missing-connection", otherA]) {
      await run("cursor:" + id + ":" + shared);
    }
    assert.equal(captured.length, beforeRejected, "invalid account IDs must never fall back to a valid credential");
  } finally { modules[1].updateProviderConnection(second, owner, { secret: "cursor-b-key" }); }
});

async function get(authenticated = true) {
  return modules[3].GET(new Request("http://localhost/api/models", {
    headers: authenticated ? { cookie: "ai_chat_auth=" + token } : {},
  }));
}

test("real models API discovers both Cursor accounts without deduplicating other providers", async () => {
  calls.length = 0;
  const response = await get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual([...calls].sort(), ["cursor-a-key", "cursor-b-key"]);
  assert.equal(body.models.length, 4);
  for (const [id, label, contextWindow] of [
    [first, "cursor-a", 234567], [second, "cursor-b", 345678],
  ] as const) {
    const model = body.models.find((m: { id: string }) => m.id === "cursor:" + id + ":" + shared);
    assert.ok(model, "separate scoped Cursor model");
    assert.equal(model.connectionId, id);
    assert.equal(model.connectionLabel, label);
    assert.equal(model.contextWindow, contextWindow);
    assert.equal(model.displayName, "Live " + label + "-key");
    assert.deepEqual(model.parameters[0].values, [{ value: "fixture-effort" }]);
    assert.deepEqual(model.defaultParams, [{ id: "effort", value: "fixture-effort" }]);
    assert.equal(modules[1].listProviderModels(id)[0].id, shared, "cache keeps provider-native ID");
  }
  for (const id of [otherA, otherB]) assert.ok(body.models.some(
    (m: { id: string }) => m.id === "compatible:" + id + ":" + shared,
  ));
  assert.equal(body.models.some((m: { connectionId: string }) => [foreignConnection, disabled].includes(m.connectionId)), false);
  assert.ok(body.models.some((m: { id: string }) => m.id === body.defaultModelId));
});

test("one Cursor discovery failure preserves the other account", async () => {
  failingKey = "cursor-a-key";
  try {
    const body = await (await get()).json();
    assert.ok(body.models.some((m: { connectionId: string }) => m.connectionId === second));
    assert.equal(body.models.some((m: { connectionId: string }) => m.connectionId === first), false);
    assert.match(body.error, /fixture discovery unavailable/);
  } finally { failingKey = ""; }
});

test("unauthenticated models request does not discover accounts", async () => {
  calls.length = 0;
  assert.equal((await get(false)).status, 401);
  assert.deepEqual(calls, []);
});

test("Cursor model keys preserve scope and legacy raw IDs", () => {
  const { modelKey, parseModelKey } = modules[4];
  assert.equal(modelKey("cursor", shared), shared);
  assert.equal(modelKey("cursor", shared, second), "cursor:" + second + ":" + shared);
  assert.deepEqual(parseModelKey(shared), { providerKey: "cursor", modelId: shared });
  assert.deepEqual(parseModelKey(modelKey("cursor", "fixture:model", second)), {
    providerKey: "cursor", connectionId: second, modelId: "fixture:model",
  });
});

test("legacy raw Cursor permissions also expose scoped API models", async () => {
  const db = modules[7].getDatabase();
  db.prepare("DELETE FROM user_model_permissions WHERE user_id = ?").run(owner);
  db.prepare("INSERT INTO user_model_permissions (user_id, model_id, created_at) VALUES (?, ?, ?)")
    .run(owner, shared, new Date().toISOString());
  try {
    const body = await (await get()).json();
    assert.deepEqual(body.models.map((m: { connectionId: string }) => m.connectionId).sort(), [first, second].sort());
    assert.equal(modules[6].isModelAllowed(owner, "cursor:" + second + ":" + shared), true);
  } finally { modules[6].ensureAllModelAccess(owner); }
});

test("Cursor access fails closed for foreign, disabled, missing and wrong-provider scope", () => {
  const access = modules[6];
  for (const id of [foreignConnection, disabled, "missing-connection", otherA]) {
    assert.equal(access.isModelAllowed(owner, "cursor:" + id + ":" + shared), false);
  }
  assert.equal(access.isModelAllowed(owner, "cursor:" + second + ":" + shared), true);
  assert.equal(access.isModelAllowed(owner, shared), true, "legacy permission remains usable");
});
