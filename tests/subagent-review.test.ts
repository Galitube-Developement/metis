import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const file = ts.createSourceFile("worker.ts", readFileSync("worker.ts", "utf8"), ts.ScriptTarget.Latest, true);
const handler = file.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "reconcileSubagentParent")!;
const js = ts.transpileModule(handler.getText(file), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options: { agentChat?: boolean; parent?: Record<string, unknown>; child?: Record<string, unknown>; existingReview?: boolean } = {}) {
  const parent = { id: "parent", chatId: "chat", userId: "owner", modeId: "agent", status: "completed", ...options.parent };
  const children: Record<string, unknown>[] = [
    { id: "child", chatId: "child-chat", userId: "owner", status: "completed", subagentAutoReview: true, ...options.child },
  ];
  if (options.existingReview) children.push({ id: "existing-review", subagentFollowUp: true });
  const prompts: string[] = [], queued: Record<string, unknown>[] = [], updates: unknown[] = [], events: unknown[] = [];
  const context = {
    getJob: () => parent,
    getProjectAgentForChat: (chatId: string, owner: string) => options.agentChat && chatId === "chat" && owner === "owner" ? { id: "project-agent" } : null,
    listChildJobs: () => children,
    getChat: () => ({ messages: [{ role: "assistant", content: "Child outcome" }] }),
    randomUUID: () => "review-message",
    enqueueJob: (input: Record<string, unknown>, hooks: { beforeInsert: () => void }) => {
      hooks.beforeInsert(); queued.push(input);
      children.push({ id: "review", subagentFollowUp: true });
      return { id: "review-job" };
    },
    appendMessageInTransaction: (_chatId: string, message: { content: string }) => prompts.push(message.content),
    updateChat: (...args: unknown[]) => updates.push(args),
    appendRunEvent: (...args: unknown[]) => events.push(args),
  };
  const reconcile = vm.runInNewContext(js + "; reconcileSubagentParent", context) as (id: string) => void;
  return { reconcile: () => reconcile("parent"), prompts, queued, updates, events };
}

for (const parent of [{}, { projectId: "project" }, { agentId: "provider-session", modeId: "agent" }]) {
  test("normal chats never get an automatic review: " + JSON.stringify(parent), () => {
    const f = fixture({ parent });
    f.reconcile();
    assert.equal(f.prompts.length, 0);
    assert.equal(f.queued.length, 0);
    assert.equal(f.updates.length, 0);
    assert.equal(f.events.length, 0);
  });
}

for (const options of [{ agentChat: true }, { parent: { parentJobId: "upstream", subagentDepth: 1 } }]) {
  test("agent chats keep one durable review: " + JSON.stringify(options), () => {
    const f = fixture(options);
    f.reconcile(); f.reconcile();
    assert.equal(f.queued.length, 1);
    assert.equal(f.prompts.length, 1);
    assert.match(f.prompts[0], /Child outcome/);
    assert.equal(f.queued[0].subagentFollowUp, true);
    assert.equal(f.queued[0].chatId, "chat");
    assert.equal(f.events.length, 1);
  });
}

for (const options of [
  { child: { status: "running" } },
  { child: { status: "waiting_for_user" } },
  { existingReview: true },
  { parent: { subagentFollowUp: true } },
  { parent: { status: "running" } },
  { child: { subagentAutoReview: false } },
]) {
  test("agent review keeps its lifecycle guards: " + JSON.stringify(options), () => {
    const f = fixture({ agentChat: true, ...options });
    f.reconcile();
    assert.equal(f.queued.length, 0);
    assert.equal(f.prompts.length, 0);
  });
}
