import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mergeQueuedFollowUps, shouldStartQueuedFollowUp } from "../lib/composer-send";

const file = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: Record<string, string> = {};
function find(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["sendQueuedMessage", "applyServerQueuedMessages", "persistQueuedFollowUps"].includes(node.name?.text ?? "")) handlers[node.name!.text] = node.getText(file);
  ts.forEachChild(node, find);
}
find(file);
assert.equal(Object.keys(handlers).length, 3);
const js = ts.transpileModule(Object.values(handlers).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture() {
  const first = { id: "first", text: "first queued", files: [] };
  const second = { id: "second", text: "second queued", files: [] };
  let queue = [first, second];
  let aborts = 0;
  const calls: Array<{ args: unknown[]; finish: () => void }> = [];
  const queueDrainRef = { current: false };
  const queueDrainBlockedRef = { current: false };
  const queuedSendRef = { current: new Set<string>() };
  const saved: Array<{ queuedMessages: typeof queue }> = [];
  const context = {
    activeChatIdRef: { current: "chat" },
    runtimeRef: { current: new Map([["chat", { abortController: { abort: () => { aborts++; } } }]]) },
    busy: true, busyRef: { current: true },
    modelId: "unit-test-selection",
    pendingQuestion: { questionId: "old-question" }, pendingQuestionIdRef: { current: "old-question" as string | null },
    sendInFlightKeysRef: { current: new Set<string>() }, queueDrainRef, queueDrainBlockedRef, queuedSendRef,
    shouldStartQueuedFollowUp, mergeQueuedFollowUps,
    stateRef: { current: { messages: [] as Array<{ id: string; role: string }> } },
    removedIdsFor: () => new Set<string>(),
    fetch: async (_url: string, request: { body: string }) => { saved.push(JSON.parse(request.body)); return Response.json({}); },
    setQueuedMessages: (update: (current: typeof queue) => typeof queue) => { queue = update(queue); },
    setSendLockTick: () => {}, setPendingQuestion: () => {}, setPendingApproval: () => {},
    toast: { info: () => {}, error: () => {} },
    send: (...args: unknown[]) => new Promise<void>((resolve) => { calls.push({ args, finish: resolve }); }),
  };
  const methods = vm.runInNewContext(js + "; ({ sendQueuedMessage, applyServerQueuedMessages, persistQueuedFollowUps })", context) as {
    sendQueuedMessage: (message: typeof first) => Promise<void>;
    applyServerQueuedMessages: (messages: typeof queue) => void;
    persistQueuedFollowUps: (messages: typeof queue) => void;
  };
  return { first, second, context, calls, saved, queueDrainRef, queuedSendRef, ...methods,
    queue: () => queue, aborts: () => aborts };
}

test("the real Send now handler submits during a running run and releases its lock on acceptance", async () => {
  const f = fixture();
  const first = f.sendQueuedMessage(f.first);
  assert.equal(f.calls.length, 1);
  assert.equal(f.aborts(), 1);
  assert.equal(f.calls[0].args[9], true, "API receives the explicit Send now intent");
  assert.equal(f.queuedSendRef.current.has(f.first.id), true);
  assert.deepEqual(f.queue(), [f.first, f.second], "Keep the message until accepted");
  (f.calls[0].args[7] as () => void)();
  assert.deepEqual(f.queue(), [f.second]);
  assert.equal(f.queueDrainRef.current, false, "Do not lock Send now for the entire SSE stream");
  assert.equal(f.context.pendingQuestionIdRef.current, null);
  const second = f.sendQueuedMessage(f.second);
  assert.equal(f.calls.length, 2);
  f.calls[0].finish();
  await first;
  assert.equal(f.queueDrainRef.current, true, "Old stream cleanup cannot release the newer POST lock");
  assert.equal(f.queuedSendRef.current.has(f.second.id), true);
  (f.calls[1].args[7] as () => void)();
  f.calls[1].finish();
  await second;
  assert.equal(f.queuedSendRef.current.size, 0);
});

test("a double click before acceptance submits only once", async () => {
  const f = fixture();
  const sending = f.sendQueuedMessage(f.first);
  await f.sendQueuedMessage(f.first);
  await f.sendQueuedMessage(f.second);
  assert.equal(f.calls.length, 1);
  f.calls[0].finish();
  await sending;
  assert.deepEqual(f.queue(), [f.first, f.second], "Unaccepted messages remain queued");
});

test("no selected model leaves the queue and the live stream intact", async () => {
  const f = fixture();
  f.context.modelId = "";
  await f.sendQueuedMessage(f.first);
  assert.equal(f.calls.length, 0);
  assert.equal(f.aborts(), 0);
  assert.deepEqual(f.queue(), [f.first, f.second]);
});

test("live sync and autosave retain an unaccepted queued submission even with its optimistic user message", async () => {
  const f = fixture();
  const sending = f.sendQueuedMessage(f.first);
  f.context.stateRef.current.messages = [{ id: f.first.id, role: "user" }];
  f.applyServerQueuedMessages([f.first, f.second]);
  assert.equal(f.queue().length, 2);
  f.persistQueuedFollowUps(f.queue());
  assert.deepEqual(f.saved[0].queuedMessages.map((message) => message.id), [f.first.id, f.second.id]);
  (f.calls[0].args[7] as () => void)();
  f.applyServerQueuedMessages([f.first, f.second]);
  assert.equal(f.queue().length, 1);
  assert.equal(f.queue()[0].id, f.second.id);
  f.calls[0].finish();
  await sending;
});
