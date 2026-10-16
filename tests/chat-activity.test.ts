import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatActivityIndicator, projectActivityIndicator } from "../lib/chat-activity";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-unread-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AGENT_CWD: dir, AI_CHAT_ROOT: dir });
delete process.env.AI_CHAT_JOB_ID; delete process.env.AI_CHAT_WORKER_ID; delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
after(() => rmSync(dir, { recursive: true, force: true }));

test("questions and errors supersede unread progress across a project", () => {
  assert.equal(chatActivityIndicator({ unread: true }), "unread");
  assert.equal(chatActivityIndicator({ unread: true, badge: "red" }), "error");
  assert.equal(chatActivityIndicator({ unread: true, badge: "red", pendingQuestion: {} }), "question");
  assert.equal(projectActivityIndicator([{ unread: true }, { badge: "red" }, { pendingApproval: {} }]), "question");
  assert.equal(projectActivityIndicator([{ unread: true }, { badge: "red" }]), "error");
  assert.equal(projectActivityIndicator([{ unread: true, archived: true }, {}]), null);
  assert.equal(chatActivityIndicator({ unread: false, badge: "blue" }), null, "completion is not new progress after reading");
});

test("project work supersedes unread progress, includes the visible agent, and yields to attention", () => {
  assert.equal(projectActivityIndicator([{ id: "open", runStatus: "running", unread: true }], "open"), "running");
  assert.equal(projectActivityIndicator([{ unread: true }, { runStatus: "running" }]), "running");
  assert.equal(projectActivityIndicator([{ runStatus: "running" }, { pendingQuestion: {} }]), "question");
  assert.equal(projectActivityIndicator([{ runStatus: "running" }, { pendingApproval: {} }]), "question");
  assert.equal(projectActivityIndicator([{ runStatus: "running" }, { badge: "red" }]), "error");
  assert.equal(projectActivityIndicator([{ runStatus: "running", archived: true }, { unread: true }]), "unread");
  for (const runStatus of ["paused", "cancelled", "idle", "completed", "interrupted"]) {
    assert.equal(projectActivityIndicator([{ runStatus, unread: true }]), "unread");
  }
  assert.equal(projectActivityIndicator([{ id: "open", unread: true, runStatus: "completed" }], "open"), null);
  assert.equal(projectActivityIndicator([{ id: "open" }, { id: "other", unread: true }], "open"), "unread");
});

test("durable message progress and bounded read acknowledgements survive refreshes", async t => {
  const [store, auth, api, sqlite] = await Promise.all([import("../lib/db-store"), import("../lib/auth"), import("../app/api/chats/[id]/route"), import("../lib/sqlite")]);
  const owner = auth.createUser("unread-owner", "test-password"), stranger = auth.createUser("unread-stranger", "test-password");
  const cookie = "ai_chat_auth=" + auth.authenticateUser("unread-owner", "test-password")!.token;
  const chat = store.createChat("Progress", undefined, owner.id);
  const summary = () => store.listChatsForUser(owner.id).find(c => c.id === chat.id)!;
  const page = () => store.getChatPage(chat.id, owner.id, 10, 0)!.chat;
  const patch = (body: unknown, credential = cookie) => api.PATCH(new Request("http://test/api/chats/" + chat.id, { method: "PATCH", headers: { cookie: credential, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: chat.id }) });

  await t.test("empty placeholders and metadata do not create progress", () => {
    store.appendMessage(chat.id, { id: "answer", role: "assistant", content: "" }, owner.id);
    store.updateChat(chat.id, { title: "Renamed", runStatus: "running", sessionState: { input: "draft" } }, owner.id);
    assert.equal(summary().unread, false);
    assert.equal(page().activityRevision, 0);
  });
  await t.test("streaming checkpoints immediately update compact summaries", () => {
    store.upsertMessage(chat.id, { id: "answer", role: "assistant", content: "First tokens" });
    assert.equal(summary().unread, true);
    assert.equal(summary().activityRevision, 1);
    assert.equal(page().activityRevision, 1);
    assert.equal(store.listChatsForUser(stranger.id).length, 0);
    store.upsertMessage(chat.id, { id: "answer", role: "assistant", content: "First tokens" });
    assert.equal(summary().activityRevision, 1, "repeated checkpoints are inert");
  });
  await t.test("a delayed acknowledgement leaves newer tokens unread", async () => {
    const viewed = page().activityRevision!;
    store.upsertMessage(chat.id, { id: "answer", role: "assistant", content: "First tokens and more" });
    assert.equal((await patch({ readRevision: viewed, badge: null })).status, 200);
    assert.equal(summary().activityRevision, 2);
    assert.equal(summary().readRevision, 1);
    assert.equal(summary().unread, true);
    assert.equal((await patch({ readRevision: 2, badge: null })).status, 200);
    store.clearStoreCaches();
    assert.equal(summary().unread, false);
    assert.equal(page().readRevision, 2);
    store.updateChat(chat.id, { badge: "blue" }, owner.id);
    assert.equal(summary().unread, false, "done does not replay read content");
  });
  await t.test("new calls and call results count, timestamps and usage do not", () => {
    const message = { id: "answer", role: "assistant" as const, content: "First tokens and more", tools: [{ id: "tool", name: "read_file", status: "running" as const }] };
    store.upsertMessage(chat.id, message);
    assert.equal(summary().activityRevision, 3);
    store.upsertMessage(chat.id, { ...message, tools: [{ ...message.tools[0], status: "completed", result: "Read result" }] });
    assert.equal(summary().activityRevision, 4);
    store.updateChat(chat.id, { queueMessage: "worker ready", sessionState: { input: "still a draft" } }, owner.id);
    assert.equal(summary().activityRevision, 4);
  });
  await t.test("an error arriving after the viewed snapshot survives its stale acknowledgement", async () => {
    store.updateChat(chat.id, { badge: "red", runStatus: "error" }, owner.id);
    assert.equal(summary().activityRevision, 5);
    await patch({ readRevision: 4, badge: null });
    assert.equal(summary().badge, "red");
    assert.equal(summary().unread, true);
    await patch({ readRevision: 5, badge: null });
    assert.equal(summary().badge, undefined);
    assert.equal(summary().unread, false);
  });
  await t.test("read updates are owned, validated and monotonic", async () => {
    const otherCookie = "ai_chat_auth=" + auth.authenticateUser("unread-stranger", "test-password")!.token;
    assert.equal((await patch({ readRevision: 4 }, otherCookie)).status, 404);
    for (const readRevision of [-1, 1.5, "4", null]) assert.equal((await patch({ readRevision })).status, 400);
    assert.equal((await patch({ readRevision: 99999 })).status, 200);
    assert.equal(summary().readRevision, 5);
    await patch({ readRevision: 1 });
    assert.equal(summary().readRevision, 5);
    store.deleteChat(chat.id, owner.id);
    assert.equal(sqlite.getDatabase().prepare("SELECT 1 FROM chat_activity WHERE chat_id=?").get(chat.id), undefined);
  });
});
