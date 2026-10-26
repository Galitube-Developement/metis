import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-provider-connections-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AI_CHAT_ROOT: root, AGENT_CWD: root, AI_CHAT_SECRETS_KEY: "00".repeat(32),
  CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
});
after(() => rmSync(root, { recursive: true, force: true }));

async function fixture() {
  const connections = await import("../lib/provider-connections");
  const { getDatabase } = await import("../lib/sqlite");
  const ownerId = randomUUID();
  getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(ownerId, ownerId, "unused", new Date().toISOString());
  const token = randomUUID();
  getDatabase().prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), ownerId, new Date(Date.now() + 60_000).toISOString());
  return { ...connections, ownerId, token };
}
function request(token: string, body: unknown, method = "POST") {
  return new Request("http://localhost/api/providers", {
    method, headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const input = { providerKey: "codex", slug: "codex-main", label: "Personal", authType: "api_key" as const };

test("every provider/auth type creates independent accounts for repeated slugs", async () => {
  const f = await fixture();
  const { listProviderDefinitions } = await import("../lib/providers/registry");
  for (const provider of listProviderDefinitions()) {
    for (const authType of provider.authTypes) {
      const data = { ...input, providerKey: provider.key, slug: provider.key + "-account", authType };
      const first = f.upsertProviderConnection(f.ownerId, { ...data, secret: "fixture-first" })!;
      const second = f.upsertProviderConnection(f.ownerId, { ...data, label: "Work", secret: "fixture-second" })!;
      assert.notEqual(first.id, second.id, provider.key + "/" + authType);
      assert.notEqual(first.slug, second.slug);
      assert.equal(f.getProviderConnection(first.id, f.ownerId)?.label, "Personal");
      assert.equal(f.getProviderConnectionSecret(first.id, f.ownerId)?.secret, "fixture-first");
      assert.equal(f.getProviderConnectionSecret(second.id, f.ownerId)?.secret, "fixture-second");
    }
  }
});

test("starting another pending OAuth account leaves an existing account visible and intact", async () => {
  const f = await fixture();
  for (const providerKey of ["codex", "claude-code", "antigravity"]) {
    const data = { ...input, providerKey, slug: providerKey + "-oauth", authType: "oauth" as const };
    const existing = f.upsertProviderConnection(f.ownerId, { ...data, secret: "fixture-oauth" })!;
    const pending = f.upsertProviderConnection(f.ownerId, { ...data, config: { pendingOAuthFlow: true } })!;
    assert.notEqual(existing.id, pending.id);
    assert.ok(f.listProviderConnections(f.ownerId).some(c => c.id === existing.id));
    assert.ok(!f.listProviderConnections(f.ownerId).some(c => c.id === pending.id));
    f.updateProviderConnection(pending.id, f.ownerId, { secret: "fixture-new-oauth", config: {} });
    assert.equal(f.getProviderConnectionSecret(existing.id, f.ownerId)?.secret, "fixture-oauth");
    assert.equal(f.getProviderConnectionSecret(pending.id, f.ownerId)?.secret, "fixture-new-oauth");
  }
});

test("an explicit foreign or unknown id cannot create or overwrite an account", async () => {
  const first = await fixture();
  const other = await fixture();
  const saved = first.upsertProviderConnection(first.ownerId, { ...input, secret: "fixture-owned" })!;
  assert.throws(() => other.upsertProviderConnection(other.ownerId, { ...input, id: saved.id, label: "Overwrite" }), /not found/i);
  assert.equal(first.getProviderConnection(saved.id, first.ownerId)?.label, "Personal");
  assert.equal(first.getProviderConnectionSecret(saved.id, first.ownerId)?.secret, "fixture-owned");
  assert.throws(() => first.upsertProviderConnection(first.ownerId, { ...input, id: randomUUID() }), /not found/i);
});

test("renaming and explicit updates retain the account id, credential and discovered models", async () => {
  const f = await fixture();
  const first = f.upsertProviderConnection(f.ownerId, { ...input, secret: "fixture-personal" })!;
  const second = f.upsertProviderConnection(f.ownerId, { ...input, slug: "codex-work", label: "Work", secret: "fixture-work" })!;
  f.saveProviderModels(first.id, [{ id: "fixture-model", displayName: "Fixture" }]);
  const renamed = f.updateProviderConnection(first.id, f.ownerId, { label: second.label })!;
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.slug, first.slug);
  const updated = f.upsertProviderConnection(f.ownerId, { ...input, id: first.id, label: "Renamed" })!;
  assert.equal(updated.id, first.id);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(f.getProviderConnectionSecret(first.id, f.ownerId)?.secret, "fixture-personal");
  assert.equal(f.getProviderConnectionSecret(second.id, f.ownerId)?.secret, "fixture-work");
  assert.equal(f.listProviderModels(first.id)[0]?.id, "fixture-model");
});

test("slug collisions remain bounded and scoped to the owner", async () => {
  const f = await fixture();
  const other = await fixture();
  const slug = "a".repeat(64);
  const first = f.upsertProviderConnection(f.ownerId, { ...input, slug })!;
  const second = f.upsertProviderConnection(f.ownerId, { ...input, slug })!;
  const third = f.upsertProviderConnection(f.ownerId, { ...input, slug })!;
  assert.equal(first.slug, slug);
  assert.equal(second.slug, "a".repeat(62) + "-2");
  assert.equal(third.slug, "a".repeat(62) + "-3");
  assert.equal(f.upsertProviderConnection(other.ownerId, { ...input, slug })?.slug, slug);
});

test("provider API creates separate accounts and rejects foreign-id updates", async () => {
  const f = await fixture();
  const other = await fixture();
  const collection = await import("../app/api/providers/route");
  const item = await import("../app/api/providers/[id]/route");
  const firstResponse = await collection.POST(request(f.token, { ...input, secret: "fixture-api" }));
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()).connection;
  const secondResponse = await collection.POST(request(f.token, input));
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()).connection;
  assert.notEqual(first.id, second.id);
  const rename = await item.PATCH(request(f.token, { label: "Renamed" }, "PATCH"), { params: Promise.resolve({ id: first.id }) });
  assert.equal(rename.status, 200);
  assert.equal((await rename.json()).connection.id, first.id);
  assert.equal((await collection.POST(request(other.token, { ...input, id: first.id }))).status, 400);
  assert.equal((await item.PATCH(request(other.token, { label: "Foreign" }, "PATCH"), { params: Promise.resolve({ id: first.id }) })).status, 404);
  assert.equal(f.getProviderConnection(first.id, f.ownerId)?.label, "Renamed");
  assert.equal(f.getProviderConnectionSecret(first.id, f.ownerId)?.secret, "fixture-api");
  assert.equal((await collection.POST(request("", input))).status, 401);
});

test("voice credential saves explicitly update their account without replacing a chat account", async () => {
  const f = await fixture();
  const voice = await import("../app/api/voice/credentials/route");
  const chat = f.upsertProviderConnection(f.ownerId, { ...input, providerKey: "openai", slug: "voice-openai", secret: "fixture-chat", config: { purpose: "chat" } })!;
  const first = await voice.POST(request(f.token, { provider: "openai", apiKey: "fixture-voice-1" }));
  assert.equal(first.status, 200);
  const id = (await first.json()).connectionId;
  const second = await voice.POST(request(f.token, { provider: "openai", apiKey: "fixture-voice-2" }));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).connectionId, id);
  assert.notEqual(id, chat.id);
  assert.equal(f.getProviderConnectionSecret(id, f.ownerId)?.secret, "fixture-voice-2");
  assert.equal(f.getProviderConnectionSecret(chat.id, f.ownerId)?.secret, "fixture-chat");
});

test("connection model keys resolve the selected account after renaming", async () => {
  const f = await fixture();
  const { modelKey, parseModelKey } = await import("../lib/providers/types");
  const accounts = [0, 1].map(index => f.upsertProviderConnection(f.ownerId, { ...input, slug: "routing-" + index, secret: "fixture-" + index })!);
  for (const [index, account] of accounts.entries()) {
    const key = modelKey("codex", "fixture-model", account.id);
    f.updateProviderConnection(account.id, f.ownerId, { label: "Same name" });
    const parsed = parseModelKey(key);
    assert.equal(parsed.connectionId, account.id);
    assert.equal(f.getProviderConnectionSecret(parsed.connectionId!, f.ownerId)?.secret, "fixture-" + index);
    assert.equal(f.getProviderConnection(parsed.connectionId!, "foreign-owner"), null);
  }
});
