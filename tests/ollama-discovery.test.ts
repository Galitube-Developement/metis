import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const data = mkdtempSync(path.join(os.tmpdir(), "metis-ollama-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: data, CHAT_DB_PATH: path.join(data, "chat.sqlite"),
  AI_CHAT_ROOT: data, AGENT_CWD: data, AI_CHAT_SECRETS_KEY: "bc".repeat(32),
  CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
});
after(() => rmSync(data, { recursive: true, force: true }));
const modules = Promise.all([
  import("../lib/providers/discovery"), import("../lib/provider-connections"),
  import("../lib/providers/ollama"), import("../lib/auth"),
  import("../lib/model-access"), import("../app/api/models/route"),
]);

async function fixture() {
  const [discovery, connections, ollama, auth, access, models] = await modules;
  const username = "ollama-" + Math.random().toString(36).slice(2);
  const owner = auth.createUser(username, "fixture-password").id;
  access.ensureAllModelAccess(owner);
  const token = auth.authenticateUser(username, "fixture-password")!.token;
  const connection = connections.upsertProviderConnection(owner, {
    providerKey: "ollama", slug: username, label: "Local fixture", authType: "local",
    baseUrl: "http://127.0.0.1:11434",
  })!;
  return { discovery, connections, ollama, owner, token, connection, models };
}

test("Ollama origin and compatible URLs use the same native and runtime endpoints", async () => {
  const [, , ollama] = await modules;
  for (const url of ["http://localhost:11434", "http://localhost:11434/v1///?ignored=yes"]) {
    assert.deepEqual(ollama.ollamaBaseUrls(url), {
      native: "http://localhost:11434", compatible: "http://localhost:11434/v1",
    });
  }
  assert.deepEqual(ollama.ollamaBaseUrls("https://fixture.test/ollama/v1/"), {
    native: "https://fixture.test/ollama", compatible: "https://fixture.test/ollama/v1",
  });
});

test("installed models and explicit capabilities survive connection testing into the real picker API", async t => {
  const f = await fixture();
  const localId = "my-instruct:latest";
  const models = [localId, "fixture-vision:4b", "embedding-only:latest"];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith("/api/tags")) return Response.json({ models: models.map(name => ({ name })) });
    assert.equal(url, "http://127.0.0.1:11434/api/show");
    assert.equal(init?.method, "POST");
    const model = JSON.parse(String(init?.body)).model;
    return Response.json({
      capabilities: model === models[2] ? ["embedding"] : model === models[1] ? ["completion", "vision"] : ["completion", "tools"],
      model_info: { "general.architecture": "fixture", "fixture.context_length": 123456 },
    });
  });
  const result = await f.discovery.testProviderConnection(f.connection);
  assert.equal(result.detail, "2 models available.");
  assert.deepEqual(f.connections.listProviderModels(f.connection.id).map(m => m.id).sort(), models.slice(0, 2).sort());
  const resolved = f.discovery.providerModelsForConnection(f.connection);
  const instruct = resolved.find(m => m.id === localId)!;
  const vision = resolved.find(m => m.id === models[1])!;
  assert.equal(instruct.capabilities?.tools, true);
  assert.equal(instruct.capabilities?.vision, false);
  assert.equal(vision.capabilities?.tools, false, "registry defaults must not overwrite live unsupported tools");
  assert.equal(vision.capabilities?.vision, true);
  assert.equal(instruct.contextWindow, 123456);
  const response = await f.models.GET(new Request("http://localhost/api/models", {
    headers: { cookie: "ai_chat_auth=" + f.token },
  }));
  const body = await response.json();
  const visible = body.models.filter((m: { connectionId?: string }) => m.connectionId === f.connection.id);
  assert.deepEqual(visible.map((m: { id: string }) => m.id).sort(), models.slice(0, 2).map(id => "ollama:" + f.connection.id + ":" + id).sort());
  assert.equal(visible.find((m: { id: string }) => m.id.endsWith(":" + models[1])).capabilities.tools, false);
  const { sanitizeModelParams } = await import("../lib/model-params");
  assert.deepEqual(sanitizeModelParams(visible[0], [{ id: "effort", value: "high" }]), []);
});

test("compatible-only Ollama proxies list live IDs without guessed model capabilities", async t => {
  const f = await fixture();
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).endsWith("/v1/models")) return Response.json({ data: [{ id: "custom:8b" }] });
    return new Response("not exposed", { status: 404 });
  });
  const discovered = await f.discovery.discoverProviderModels(f.connection);
  assert.deepEqual(discovered.map(model => model.id), ["custom:8b"]);
  assert.equal(discovered[0].capabilities?.tools, undefined);
  assert.equal(discovered[0].capabilities?.vision, undefined);
  assert.equal(discovered[0].contextWindow, undefined);
  assert.equal(discovered[0].parameters, undefined);
  await f.discovery.refreshProviderModels(f.connection);
  const resolved = f.discovery.providerModelsForConnection(f.connection)[0];
  assert.equal(resolved.capabilities?.tools, undefined);
  assert.equal(resolved.capabilities?.vision, undefined);
});

test("empty Ollama installation clears stale models and exposes no registry examples", async t => {
  const f = await fixture();
  f.connections.saveProviderModels(f.connection.id, [{ id: "removed:latest", displayName: "Removed" }]);
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    assert.ok(String(input).endsWith("/api/tags"));
    return Response.json({ models: [] });
  });
  assert.deepEqual(await f.discovery.refreshProviderModels(f.connection), []);
  assert.deepEqual(f.discovery.providerModelsForConnection(f.connection), []);
});

test("unreachable Ollama reports which host must reach localhost", async t => {
  const f = await fixture();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("ECONNREFUSED"); });
  await assert.rejects(f.discovery.discoverProviderModels(f.connection), /127\.0\.0\.1:11434.*ECONNREFUSED.*machine running Metis/);
});

test("selected native Ollama model IDs reach the compatible runtime unchanged", async t => {
  const f = await fixture();
  const [{ aiModel }, { generateText }, { parseModelKey }] = await Promise.all([
    import("../lib/providers/adapters/provider-support"), import("ai"), import("../lib/providers/types"),
  ]);
  const id = "my-local-model:latest";
  const selected = parseModelKey("ollama:" + f.connection.id + ":" + id);
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(String(input), "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(JSON.parse(String(init?.body)).model, id);
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: id,
      choices: [{ index: 0, message: { role: "assistant", content: "fixture reply" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  const result = await generateText({ model: aiModel(selected.providerKey, selected.modelId, f.connection), prompt: "fixture" });
  assert.equal(result.text, "fixture reply");
});
