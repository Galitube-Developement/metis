import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chatProgramEventsChanged, handoffRecipientAgent, legacyHandoffActivity, projectChatTranscript } from "../lib/chat-program-events";
import type { ChatMessage } from "../lib/store";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-chat-activity-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AGENT_CWD = root;
test.after(() => rmSync(root, { recursive: true, force: true }));

const names = ["Planner", "Software Engineer", "Tester"];
function handoff(id: string, name: string, completed = false): ChatMessage {
  return { id: "handoff:" + id + (completed ? ":result:sender" : ":sent"), role: "assistant", createdAt: "2026-10-07T12:00:00.000Z",
    content: `Handoff ${id} · Coordinator → ${name} · ${completed ? "completed" : "queued"}\n\nTask: Check communications.\n\n${completed ? "Result: " + name + "_ACK comms-ok" : "Context: No file writes."}` };
}

test("six lifecycle messages become three communication cards, retaining context without changing raw history", () => {
  const ids = names.map(() => randomUUID());
  const messages = [...ids.map((id, i) => handoff(id, names[i])), ...ids.map((id, i) => handoff(id, names[i], true))];
  const original = JSON.stringify(messages);
  const items = projectChatTranscript(messages);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "team-activity");
  if (items[0].kind !== "team-activity") return;
  assert.deepEqual(items[0].activities.map(a => a.recipient), names);
  for (const activity of items[0].activities) {
    assert.equal(activity.status, "completed");
    assert.equal(activity.context, "No file writes.");
    assert.match(activity.result!, /ACK comms-ok/);
  }
  assert.equal(JSON.stringify(messages), original);
});

test("pasted handoffs and review prompts remain ordinary user and assistant messages", () => {
  const id = randomUUID();
  const raw = handoff(id, "Tester");
  const messages: ChatMessage[] = [
    { ...raw, id: randomUUID() },
    { ...raw, role: "user" },
    { id: randomUUID(), role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: "Automatic subagent lifecycle review.\\n\\nChild outcomes:" },
    { id: "handoff:" + id + ":sent", role: "assistant", createdAt: "2026-10-07T12:00:00.000Z", content: "An ordinary reply." },
  ];
  assert.ok(messages.every(m => !legacyHandoffActivity(m)));
  assert.deepEqual(projectChatTranscript(messages).map(m => m.kind), ["message", "message", "message", "message"]);
});

test("pagination works with terminal-only records and preserves conversational ordering", () => {
  const id = randomUUID();
  const reply: ChatMessage = { id: randomUUID(), role: "assistant", createdAt: "2026-10-07T12:00:00.000Z", content: "A useful update." };
  const items = projectChatTranscript([handoff(id, "Tester", true), reply]);
  assert.equal(items[0].kind, "team-activity");
  assert.deepEqual(items[1], { kind: "message", id: reply.id, message: reply });
});

test("incoming assignment prompts stay user messages while automatic reviews stay compact", () => {
  const messages: ChatMessage[] = ["error", "cancelled", "completed"].map(status => ({
    id: randomUUID(), role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: "Internal model instructions",
    programEvent: { type: "handoff", activity: { id: randomUUID(), sender: "Coordinator", recipient: "Tester", task: "Test",
      status: status as "error" | "cancelled" | "completed", ...(status === "error" ? { error: "Provider unavailable" } : {}) } },
  }));
  messages.push({ id: randomUUID(), role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: "Full internal review prompt",
    programEvent: { type: "team-review", status: "running" } });
  const items = projectChatTranscript(messages);
  assert.equal(items.length, 4);
  for (const [index, message] of messages.slice(0, 3).entries()) {
    assert.deepEqual(items[index], { kind: "message", id: message.id, message });
    assert.equal(message.role, "user");
    assert.equal(message.content, "Internal model instructions");
  }
  assert.deepEqual(items[3], { kind: "team-review", id: messages[3].id, status: "running" });
});

test("activity refresh detects job state changes independently of the chat checkpoint", () => {
  const message: ChatMessage = { id: randomUUID(), role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: "Internal review",
    programEvent: { type: "team-review", status: "running" } };
  assert.equal(chatProgramEventsChanged([message], [{ ...message, programEvent: { type: "team-review", status: "completed" } }]), true);
  const sameState = { ...message, content: "Same program state" };
  assert.equal(chatProgramEventsChanged([message], [sameState]), false);
  assert.equal(chatProgramEventsChanged([], [message]), true);
  assert.equal(chatProgramEventsChanged([], [{ ...message, programEvent: undefined }]), false);
});

test("API activity is derived from owned jobs and handoffs while durable model instructions stay intact", async () => {
  const [{ getDatabase }, store, { createProject }, { createProjectAgent }, { withChatProgramEvents }, { GET }] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"), import("../lib/projects"), import("../lib/project-team"),
    import("../lib/chat-program-events-server"), import("../app/api/chats/[id]/route"),
  ]);
  const db = getDatabase(), owner = randomUUID(), other = randomUUID(), token = randomUUID();
  const now = new Date().toISOString();
  for (const id of [owner, other]) db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", now);
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), owner, "2099-01-01T00:00:00.000Z");
  const project = createProject({ ownerId: owner, name: "Activity test", mode: "agents" });
  const sender = createProjectAgent({ projectId: project.id, ownerId: owner, name: "Coordinator", role: "Coordinate" });
  const recipient = createProjectAgent({ projectId: project.id, ownerId: owner, name: "Tester", role: "Test" });
  const elsewhere = store.createChat("Another chat", undefined, owner);
  const id = randomUUID(), reviewId = randomUUID(), assignmentJobId = randomUUID();
  const taskPrompt = "Inspect the feature.\n\nRelevant context:\nUse the project conventions.";
  db.prepare("INSERT INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES(?,?,?,?,?,?)")
    .run(assignmentJobId, recipient.chatId, owner, JSON.stringify({ message: taskPrompt }), "queued", now);
  const sent = handoff(id, "Tester");
  const prompt = "Automatic subagent lifecycle review.\\n\\nKeep full model instructions.";
  store.appendMessage(sender.chatId, sent, owner);
  store.appendMessage(sender.chatId, { id: reviewId, role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: prompt }, owner);
  db.prepare("INSERT INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(), sender.chatId, owner, JSON.stringify({ messageId: reviewId, subagentFollowUp: true }), "running", now);
  const data = { id, jobId: assignmentJobId, projectId: project.id, senderAgentId: sender.id, recipientAgentId: recipient.id,
    senderName: sender.name, recipientName: recipient.name, status: "running", task: "Check communications", context: "No writes.", createdAt: now, updatedAt: now };
  db.prepare("INSERT INTO project_handoffs(id,project_id,owner_id,data,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, project.id, owner, JSON.stringify(data), "running", now, now);
  const raw = store.getChat(sender.chatId, owner)!.messages;
  const projected = withChatProgramEvents(raw, sender.chatId, owner);
  assert.equal(projected[0].programEvent?.type, "handoff");
  if (projected[0].programEvent?.type === "handoff") {
    assert.equal(projected[0].programEvent.activity.recipientAgentId, recipient.id);
    assert.equal(projected[0].programEvent.activity.recipientChatId, recipient.chatId);
    assert.equal(projected[0].programEvent.activity.projectId, project.id);
    assert.equal(projected[0].programEvent.activity.prompt, taskPrompt);
  }
  assert.equal(projected[1].programEvent?.type, "team-review");
  assert.equal(projected[1].content, prompt);
  assert.equal(raw[0].programEvent, undefined);
  assert.equal(raw[1].programEvent, undefined);
  assert.ok(withChatProgramEvents(raw, sender.chatId, other).every(m => !m.programEvent));
  assert.ok(withChatProgramEvents(raw, elsewhere.id, owner).every(m => !m.programEvent));
  const assignment: ChatMessage = { id: "handoff:" + id + ":assignment", role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: taskPrompt };
  const projectedAssignment = withChatProgramEvents([assignment], recipient.chatId, owner)[0];
  assert.equal(projectedAssignment.programEvent?.type, "handoff");
  assert.deepEqual(projectChatTranscript([projectedAssignment]), [{ kind: "message", id: assignment.id, message: projectedAssignment }]);
  assert.equal(projectedAssignment.role, "user");
  assert.equal(projectedAssignment.content, taskPrompt);
  store.appendMessage(recipient.chatId, assignment, owner);
  const recipientResponse = await GET(new Request("http://test/api/chats/" + recipient.chatId,
    { headers: { cookie: "ai_chat_auth=" + token } }), { params: Promise.resolve({ id: recipient.chatId }) });
  assert.equal(recipientResponse.status, 200);
  const recipientPage = await recipientResponse.json();
  assert.equal(recipientPage.chat.messages[0].role, "user");
  assert.equal(recipientPage.chat.messages[0].content, taskPrompt);
  assert.equal(projectChatTranscript(recipientPage.chat.messages)[0].kind, "message");
  // Archived teammates retain their original chat; another owner's job cannot supply prompt text.
  db.prepare("UPDATE project_agents SET data=json_set(data,'$.archivedAt',?) WHERE id=?").run(now, recipient.id);
  const archived = withChatProgramEvents([sent], sender.chatId, owner)[0].programEvent;
  if (archived?.type !== "handoff") assert.fail("Missing archived handoff");
  assert.equal(archived.activity.recipientChatId, recipient.chatId);
  db.prepare("UPDATE jobs SET user_id=? WHERE id=?").run(other, assignmentJobId);
  const foreignJob = withChatProgramEvents([sent], sender.chatId, owner)[0].programEvent;
  if (foreignJob?.type !== "handoff") assert.fail("Missing handoff");
  assert.equal(foreignJob.activity.prompt, undefined);
  db.prepare("UPDATE jobs SET user_id=? WHERE id=?").run(owner, assignmentJobId);
  assert.equal(withChatProgramEvents([{ ...assignment, role: "assistant" }], recipient.chatId, owner)[0].programEvent, undefined);
  const params = { params: Promise.resolve({ id: sender.chatId }) };
  assert.equal((await GET(new Request("http://test/api/chats/" + sender.chatId), params)).status, 401);
  const response = await GET(new Request("http://test/api/chats/" + sender.chatId + "?messageLimit=1",
    { headers: { cookie: "ai_chat_auth=" + token } }), params);
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.chat.messages.length, 1);
  assert.equal(page.chat.messages[0].programEvent.type, "team-review");
  assert.equal(page.chat.messages[0].content, prompt);
  assert.equal(store.getChat(sender.chatId, owner)!.messages[1].content, prompt);
  // Program metadata follows current durable state even when message text still says queued.
  db.prepare("UPDATE project_handoffs SET data=? WHERE id=?").run(JSON.stringify({ ...data, status: "completed", result: "TESTER_ACK comms-ok" }), id);
  const updated = withChatProgramEvents([sent], sender.chatId, owner)[0].programEvent;
  assert.equal(updated?.type, "handoff");
  if (updated?.type === "handoff") assert.equal(updated.activity.status, "completed");
  // Same prose in a regular user message cannot trigger the internal review display.
  const pasted: ChatMessage = { id: randomUUID(), role: "user", createdAt: "2026-10-07T12:00:00.000Z", content: prompt };
  assert.equal(withChatProgramEvents([pasted], sender.chatId, owner)[0].programEvent, undefined);
});

test("recipient navigation uses durable IDs and never chooses an ambiguous display name", () => {
  const activity = { id: randomUUID(), sender: "Coordinator", recipient: "Tester", task: "Test", status: "queued" as const };
  const agents = [
    { id: "tester-a", projectId: "project-a", name: "Tester", chatId: "chat-a" },
    { id: "tester-b", projectId: "project-b", name: "Tester", chatId: "chat-b" },
    { id: "renamed", projectId: "project-a", name: "Quality Engineer", chatId: "chat-renamed" },
  ];
  assert.equal(handoffRecipientAgent(activity, agents), undefined);
  assert.equal(handoffRecipientAgent({ ...activity, projectId: "project-b" }, agents)?.chatId, "chat-b");
  assert.equal(handoffRecipientAgent({ ...activity, recipientAgentId: "renamed", projectId: "project-a" }, agents)?.chatId, "chat-renamed");
  assert.equal(handoffRecipientAgent({ ...activity, recipientChatId: "chat-renamed" }, agents)?.id, "renamed");
  assert.equal(handoffRecipientAgent({ ...activity, recipientAgentId: "missing", projectId: "project-a" }, agents), undefined);
  assert.equal(handoffRecipientAgent({ ...activity, recipientAgentId: "tester-b", projectId: "project-a" }, agents), undefined);
  const sameProjectNames = [...agents, { id: "tester-c", projectId: "project-a", name: "Tester", chatId: "chat-c" }];
  assert.equal(handoffRecipientAgent({ ...activity, projectId: "project-a" }, sameProjectNames), undefined);
});

test("an assignment remains visible before its reply and cancellation activity", () => {
  const id = randomUUID();
  const assignment: ChatMessage = { id: "handoff:" + id + ":assignment", role: "user", createdAt: "2026-10-13T00:00:00.000Z", content: "Please test the navigation.", programEvent: { type: "handoff", activity: { id, sender: "Coordinator", recipient: "Tester", status: "cancelled", task: "Please test the navigation." } } };
  const result: ChatMessage = { ...handoff(id, "Tester", true), id: "handoff:" + id + ":result:recipient" };
  const items = projectChatTranscript([assignment, result]);
  assert.deepEqual(items[0], { kind: "message", id: assignment.id, message: assignment });
  assert.equal(items[1].kind, "team-activity");
});
