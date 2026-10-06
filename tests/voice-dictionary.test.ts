import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { normalizeVoiceDictionary, voiceDictionaryPrompt } from "../lib/voice-dictionary";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-dictionary-test-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.CHAT_PASSWORD = "dictionary-test-password";
process.env.CHAT_LEGACY_HEADER_AUTH = "true";
process.env.OPENAI_API_KEY = "dictionary-test-key";

after(async () => { await rm(dataDir, { recursive: true, force: true }); });

test("dictionary cleans words, deduplicates and bounds malformed input", () => {
  assert.deepEqual(normalizeVoiceDictionary([" Metis AI ", "metis ai", null, "", "After   Effects"]), ["Metis AI", "After Effects"]);
  assert.deepEqual(normalizeVoiceDictionary("wrong"), []);
  assert.equal(normalizeVoiceDictionary(Array.from({ length: 120 }, (_, i) => "word" + i)).length, 100);
  assert.equal(normalizeVoiceDictionary(["x".repeat(200)])[0].length, 100);
  assert.equal(voiceDictionaryPrompt([]), undefined);
  assert.equal(voiceDictionaryPrompt(["Metis AI", "After Effects"]), "Metis AI, After Effects");
});

test("dictionary persists per owner, survives voice changes, reaches audio request and can be cleared", async () => {
  const { createUser } = await import("../lib/auth");
  const { PATCH, GET } = await import("../app/api/preferences/route");
  const { POST } = await import("../app/api/voice/transcribe/route");
  const owner = createUser("dictionary-owner", "test-password");
  const other = createUser("dictionary-other", "test-password");
  const headers = { "content-type": "application/json", "x-chat-password": "dictionary-test-password", "x-chat-username": owner.username };
  const patch = async (voiceInput: object) => {
    const response = await PATCH(new Request("http://localhost/api/preferences", { method: "PATCH", headers, body: JSON.stringify({ voiceInput }) }));
    assert.equal(response.status, 200);
    return (await response.json()).settings.voiceInput;
  };
  await patch({ provider: "openai", modelId: "whisper-1", maxDurationSeconds: 120 });
  const saved = await patch({ dictionary: [" Metis AI ", "After Effects"] });
  assert.equal(saved.modelId, "whisper-1");
  assert.equal(saved.maxDurationSeconds, 120);
  assert.deepEqual((await patch({ maxDurationSeconds: 60 })).dictionary, ["Metis AI", "After Effects"]);
  const own = await GET(new Request("http://localhost/api/preferences", { headers }));
  assert.deepEqual((await own.json()).settings.voiceInput.dictionary, ["Metis AI", "After Effects"]);
  const otherResponse = await GET(new Request("http://localhost/api/preferences", { headers: { ...headers, "x-chat-username": other.username } }));
  assert.equal((await otherResponse.json()).settings.voiceInput?.dictionary?.length ?? 0, 0);
  const originalFetch = globalThis.fetch;
  let captured: FormData | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init?.body as FormData;
    return Response.json({ text: "Metis AI uses After Effects." });
  };
  const transcribe = async () => {
    const form = new FormData();
    form.append("file", new File(["fake-audio"], "test.webm", { type: "audio/webm" }));
    form.append("durationSeconds", "1");
    form.append("modelId", "whisper-1");
    const response = await POST(new Request("http://localhost/api/voice/transcribe", { method: "POST", headers: { "x-chat-password": headers["x-chat-password"], "x-chat-username": headers["x-chat-username"] }, body: form }));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  };
  try {
    await transcribe();
    assert.equal(captured?.get("prompt"), "Metis AI, After Effects");
    await patch({ dictionary: [] });
    await transcribe();
    assert.equal(captured?.has("prompt"), false);
  } finally { globalThis.fetch = originalFetch; }
  const denied = await PATCH(new Request("http://localhost/api/preferences", { method: "PATCH", body: JSON.stringify({ voiceInput: { dictionary: ["unauthorized"] } }) }));
  assert.equal(denied.status, 401);
});
