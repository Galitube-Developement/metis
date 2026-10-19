import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-attachment-settings-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
delete process.env.CHAT_LEGACY_HEADER_AUTH;
test.after(() => rmSync(root, { recursive: true, force: true }));

test("attachment preferences authenticate, persist per account and enforce limits before upload", async () => {
  const auth = await import("../lib/auth");
  const store = await import("../lib/db-store");
  const api = await import("../app/api/attachment-settings/route");
  const uploadApi = await import("../app/api/file-uploads/route");
  const { createUpload, deleteUpload } = await import("../lib/file-upload-store");
  const { validateNoteFiles } = await import("../lib/note-attachments");
  const { saveAttachments } = await import("../lib/uploads");
  const { DEFAULT_ATTACHMENT_MAX_BYTES } = await import("../lib/upload-limits");
  const owner = auth.createUser("attachment-owner", "test-password");
  const other = auth.createUser("attachment-other", "test-password");
  const token = auth.authenticateUser(owner.username, "test-password")!.token;
  const otherToken = auth.authenticateUser(other.username, "test-password")!.token;
  function request(body?: unknown, session: string | null = token) {
    return new Request("http://test/api/attachment-settings", {
      method: body === undefined ? "GET" : "PATCH",
      headers: { "content-type": "application/json", ...(session ? { cookie: "ai_chat_auth=" + session } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  store.saveGlobalModelSettings({ modelId: "keep-selection", agentRuntimeMs: 0 }, owner.id);
  assert.equal((await api.GET(request(undefined, null))).status, 401);
  assert.equal((await api.PATCH(request({ maxBytes: 0 }, null))).status, 401);
  assert.equal((await (await api.GET(request())).json()).maxBytes, DEFAULT_ATTACHMENT_MAX_BYTES);
  for (const maxBytes of [null, "100", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await api.PATCH(request({ maxBytes }))).status, 400);
  }
  const malformed = new Request("http://test", { method: "PATCH", headers: { cookie: "ai_chat_auth=" + token }, body: "{" });
  assert.equal((await api.PATCH(malformed)).status, 400);
  for (const maxBytes of [4, 50 * 1024 ** 2, 12 * 1024 ** 3, 0]) {
    assert.equal((await api.PATCH(request({ maxBytes, ownerId: other.id }))).status, 200);
    assert.equal((await (await api.GET(request())).json()).maxBytes, maxBytes);
    assert.equal((await (await api.GET(request(undefined, otherToken))).json()).maxBytes, DEFAULT_ATTACHMENT_MAX_BYTES);
    assert.equal(store.getGlobalModelSettings(owner.id).modelId, "keep-selection");
    assert.equal(store.getGlobalModelSettings(owner.id).agentRuntimeMs, 0);
  }
  await api.PATCH(request({ maxBytes: 4 }));
  const upload = createUpload(owner.id, { name: "boundary.bin", mimeType: "", size: 4 });
  await deleteUpload(owner.id, upload.id);
  assert.throws(() => createUpload(owner.id, { name: "big.bin", mimeType: "", size: 5 }), /attachment limit/);
  const rejected = await uploadApi.POST(new Request("http://test/api/file-uploads", {
    method: "POST", headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" },
    body: JSON.stringify({ name: "big.bin", size: 5 }),
  }));
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /Settings/);
  assert.throws(() => validateNoteFiles([{ name: "big.bin", size: 5 }], owner.id), /attachment limit/);
  assert.throws(() => saveAttachments("chat", [{ name: "big.bin", mimeType: "", data: Buffer.alloc(5).toString("base64") }], owner.id), /attachment limit/);
  await api.PATCH(request({ maxBytes: 0 }));
  const huge = createUpload(owner.id, { name: "huge.bin", mimeType: "", size: 100 * 1024 ** 3 });
  assert.equal(huge.size, 100 * 1024 ** 3);
  await deleteUpload(owner.id, huge.id);
  assert.doesNotThrow(() => validateNoteFiles([{ name: "huge.bin", size: 100 * 1024 ** 3 }], owner.id));
  assert.throws(() => createUpload(owner.id, { name: "bad.bin", mimeType: "", size: Number.MAX_SAFE_INTEGER + 1 }), /at least 1 byte/);
  assert.throws(() => createUpload(owner.id, { name: "empty.bin", mimeType: "", size: 0 }), /at least 1 byte/);
});

test("attachment settings can be found in English and German", async () => {
  const { searchSettings, settingsSearchEntries } = await import("../lib/settings-navigation");
  for (const term of ["Attachments", "Anhänge", "Dateigröße", "Unlimited"]) {
    assert.ok(searchSettings(settingsSearchEntries(false), term).some(item => item.sectionId === "settings-attachments"));
  }
});
