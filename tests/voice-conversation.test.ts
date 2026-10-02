import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-voice-test-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "test.sqlite");
process.env.AI_CHAT_ROOT = root;
process.env.AGENT_CWD = root;
process.env.AI_CHAT_SECRETS_KEY = "00".repeat(32);
process.env.CHAT_PASSWORD = "";
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

async function fixture(clientTranscripts = false) {
  const { VoiceConversation } = await import("../lib/voice-conversation");
  const saved: unknown[] = [];
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  let closed = 0;
  let cleaned = 0;
  let retired = 0;
  const bridge = {
    onNotification: undefined as import("../lib/providers/codex-app-server").CodexAppServer["onNotification"],
    onExit: undefined as import("../lib/providers/codex-app-server").CodexAppServer["onExit"],
    initialize: async () => {},
    request: async <T>(method: string, params: Record<string, unknown> = {}) => {
      requests.push({ method, params });
      return {} as T;
    },
    close: async () => { closed++; },
  };
  const session = new VoiceConversation("owner", "chat", bridge,
    (transcript) => saved.push({ ...transcript }),
    async () => { cleaned++; },
    () => { retired++; }, clientTranscripts);
  session.threadId = "thread";
  const notify = (method: string, params: Record<string, unknown>) => bridge.onNotification?.({ method, params: { threadId: "thread", ...params } });
  return { session, bridge, requests, saved, notify, counts: () => ({ closed, cleaned, retired }) };
}

test("SDP arriving before the start response still establishes an audio V3 call", async () => {
  const f = await fixture();
  const result = f.session.start({ transport: { type: "webrtc", sdp: "offer" } });
  f.notify("thread/realtime/started", { version: "v3" });
  f.notify("thread/realtime/sdp", { sdp: "answer" });
  assert.equal(await result, "answer");
  assert.equal(f.session.snapshot().state, "connected");
  assert.equal(f.requests[0].params.version, "v3");
  assert.equal(f.requests[0].params.outputModality, "audio");
  await f.session.close();
});

test("start acceptance alone does not hide a later provider authentication error", async () => {
  const f = await fixture();
  const result = f.session.start({ transport: { type: "webrtc", sdp: "offer" } });
  const rejected = assert.rejects(result, /account for voice/);
  f.notify("thread/realtime/error", { message: "realtime conversation requires API key auth" });
  await rejected;
  assert.equal(f.session.snapshot().state, "error");
  assert.deepEqual(f.counts(), { closed: 1, cleaned: 1, retired: 1 });
});

test("canonical transcripts stream and save once, ignoring duplicate flat notifications", async () => {
  const f = await fixture();
  f.notify("thread/realtime/item/started", { item: { id: "one", type: "transcriptSegment", role: "user", text: "" } });
  f.notify("thread/realtime/item/transcript/delta", { itemId: "one", delta: "Hallo" });
  assert.equal(f.session.snapshot().transcripts[0].text, "Hallo");
  assert.equal(f.saved.length, 0);
  const item = { id: "one", type: "transcriptSegment", role: "user", text: "Hallo Metis" };
  f.notify("thread/realtime/item/completed", { item });
  f.notify("thread/realtime/item/completed", { item });
  f.notify("thread/realtime/transcript/done", { role: "user", text: "Hallo Metis" });
  f.notify("thread/realtime/item/transcript/delta", { itemId: "one", delta: "late" });
  f.bridge.onNotification?.({ method: "thread/realtime/item/completed", params: { threadId: "foreign", item: { ...item, id: "foreign" } } });
  assert.equal(f.saved.length, 1);
  assert.equal(f.session.snapshot().transcripts[0].text, "Hallo Metis");
  await Promise.all([f.session.close(), f.session.close()]);
  assert.deepEqual(f.counts(), { closed: 1, cleaned: 1, retired: 1 });
});

test("unanswered signaling times out and retires the process exactly once", async (t) => {
  const f = await fixture();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const start = f.session.start({});
  const rejected = assert.rejects(start, /timed out/);
  t.mock.timers.tick(30_001);
  await rejected;
  assert.deepEqual(f.counts(), { closed: 1, cleaned: 1, retired: 1 });
});

test("a vanished browser heartbeat retires the session; polling extends its lease", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const f = await fixture();
  t.mock.timers.tick(59_000);
  f.session.touch();
  t.mock.timers.tick(59_000);
  assert.equal(f.counts().closed, 0);
  t.mock.timers.tick(1_001);
  await f.session.close();
  assert.deepEqual(f.counts(), { closed: 1, cleaned: 1, retired: 1 });
});

test("offers are bounded and provider errors redact credentials", async () => {
  const { validateVoiceOffer, voiceErrorMessage } = await import("../lib/voice-conversation");
  assert.equal(validateVoiceOffer("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"), "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n");
  assert.throws(() => validateVoiceOffer("v=0\r\nm=video 9\r\n"));
  assert.throws(() => validateVoiceOffer("v=0\r\nm=audio 9\r\n" + "x".repeat(140_000)));
  assert.equal(voiceErrorMessage('{"error":{"message":"Access denied"}}'), "Access denied");
  assert.equal(voiceErrorMessage(new Error("Bearer private-token sk-secret-key")), "[redacted] [redacted]");
});

test("voice routes require authentication and reject cross-origin and oversized signaling", async () => {
  const route = await import("../app/api/voice/conversation/route");
  const { getDatabase } = await import("../lib/sqlite");
  const db = getDatabase();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("route-owner", "route-owner", "unused", new Date().toISOString());
  const token = "voice-test-session";
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(token).digest("hex"), "route-owner", new Date(Date.now() + 60_000).toISOString());
  for (const [method, handler] of [["GET", route.GET], ["POST", route.POST], ["PATCH", route.PATCH], ["DELETE", route.DELETE]] as const) {
    assert.equal((await handler(new Request("http://localhost/api/voice/conversation", { method }))).status, 401);
  }
  const headers = { cookie: "ai_chat_auth=" + token, "content-type": "application/json" };
  assert.equal((await route.POST(new Request("http://localhost/api/voice/conversation", {
    method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: "{}",
  }))).status, 403);
  assert.equal((await route.POST(new Request("http://localhost/api/voice/conversation", {
    method: "POST", headers, body: "x".repeat(170_000),
  }))).status, 413);
  assert.equal((await route.POST(new Request("http://localhost/api/voice/conversation", {
    method: "POST", headers, body: "not json",
  }))).status, 400);
});

test("another account cannot poll or end a voice session", async () => {
  const route = await import("../app/api/voice/conversation/route");
  const f = await fixture();
  const state = (globalThis as unknown as { __metisVoiceState: { sessions: Map<string, unknown> } }).__metisVoiceState;
  state.sessions.set(f.session.id, f.session);
  const request = (method: string) => new Request("http://localhost/api/voice/conversation?sessionId=" + f.session.id, {
    method, headers: { cookie: "ai_chat_auth=voice-test-session" },
  });
  assert.equal((await route.GET(request("GET"))).status, 404);
  assert.equal((await route.DELETE(request("DELETE"))).status, 404);
  assert.equal(f.counts().closed, 0);
  state.sessions.delete(f.session.id);
  await f.session.close();
});

test("WebRTC transcript batches save final turns once and reject invalid batches before mutation", async () => {
  const f = await fixture(true);
  f.session.acceptClientEvents([{type:"created",id:"turn_user",role:"user",text:"Hello"},{type:"delta",id:"turn_user",text:" Metis"}]);
  assert.equal(f.saved.length,0);
  assert.equal(f.session.snapshot().transcripts[0].text,"Hello Metis");
  assert.throws(()=>f.session.acceptClientEvents([{type:"done",id:"turn_user",role:"user",text:"Hello Metis."},{type:"done",id:"bad",role:"system",text:"bad"}]));
  assert.equal(f.saved.length,0);
  f.session.acceptClientEvents([{type:"done",id:"turn_user",role:"user",text:"Hello Metis."}]);
  f.session.acceptClientEvents([{type:"done",id:"turn_user",role:"user",text:"Hello Metis."}]);
  f.notify("thread/realtime/item/completed",{item:{id:"native_duplicate",type:"transcriptSegment",role:"user",text:"Hello Metis."}});
  assert.equal(f.saved.length,1);
  await f.session.close();
});
