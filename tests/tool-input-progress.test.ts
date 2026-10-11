import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createToolInputProgress, type ToolInputPart } from "../lib/tool-input-progress";
import { classifyToolKind, innerToolName, todosFromToolPayload } from "../lib/tool-call-display";

test("counts are per ID, throttled, flushed, and never expose incomplete input", () => {
  let time = 0;
  const events: ToolInputPart[] = [];
  const progress = createToolInputProgress(t => events.push(t), () => time);
  progress.start("a", "read_file");
  progress.start("b", "write_todos");
  progress.delta("a", '{"path":');
  progress.delta("b", '{');
  assert.equal(events.length, 2);
  time = 100;
  progress.delta("a", '"😀"');
  assert.equal(events.at(-1)?.inputChars, 12);
  assert.equal(events.at(-1)?.input, undefined);
  progress.delta("a", '}');
  progress.end("a");
  assert.equal(events.at(-1)?.inputChars, 13);
  assert.equal(events.at(-1)?.phase, "preparing");
  progress.executing({ id: "a", name: "read_file", status: "running", input: '{"path":"😀"}' });
  assert.equal(events.at(-1)?.phase, "executing");
  progress.publish({ id: "a", name: "read_file", status: "completed", result: "ok" });
  const count = events.length;
  progress.start("a", "read_file");
  progress.delta("a", "ignored");
  progress.executing({ id: "a", name: "read_file", status: "running" });
  assert.equal(events.length, count);
  assert.equal(events.at(-1)?.result, "ok");
  progress.end("b");
  assert.equal(events.at(-1)?.inputChars, 1);
});

test("buffered calls get no fabricated input counts", () => {
  const events: ToolInputPart[] = [];
  const progress = createToolInputProgress(t => events.push(t));
  progress.delta("unknown", "ignore");
  progress.executing({ id: "buffered", name: "read_file", status: "running", input: "{}" });
  assert.equal(events[0].inputChars, undefined);
});

test("actual AI SDK consumer uses fullStream identities and preserves todo/results/errors", async () => {
  const source = ts.createSourceFile("provider-support.ts", readFileSync(new URL("../lib/providers/adapters/provider-support.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "consumeAiStream")!;
  const js = ts.transpileModule(fn.getText(source) + "\nconsumeAiStream(result, context, {}, []);", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const events: ToolInputPart[] = [];
  const streams: unknown[] = [];
  const parts = [
    { type: "tool-input-start", id: "todo", toolName: "write_todos" },
    { type: "tool-input-start", id: "read", toolName: "read_file" },
    { type: "tool-input-delta", id: "todo", delta: '{"todos":' },
    { type: "tool-input-delta", id: "read", delta: '{"path":' },
    { type: "tool-input-end", id: "todo" },
    { type: "tool-call", toolCallId: "todo", toolName: "write_todos", input: { todos: [{ id: "one", content: "Inspect", status: "in_progress" }] } },
    { type: "tool-call", toolCallId: "read", toolName: "read_file", input: { path: "/tmp/a" } },
    { type: "tool-result", toolCallId: "todo", toolName: "write_todos", output: "ok" },
    { type: "tool-error", toolCallId: "read", toolName: "read_file", error: new Error("denied") },
  ];
  await vm.runInNewContext(js, {
    exports: {}, DEFAULT_PROVIDER_STEPS: 50, createToolInputProgress,
    LoopGuard: class { observe() { return {}; } },
    result: { fullStream: parts, get stream() { throw new Error("must use fullStream"); }, usage: {}, steps: [] },
    context: { signal: new AbortController().signal, onTool: (t: ToolInputPart) => events.push(t), onStream: (s: unknown) => streams.push(s), onText() {} },
    iterateUntilAborted: async function* (parts: unknown[]) { yield* parts; },
    parseToolInput: JSON.parse, innerToolName, todosFromToolPayload, classifyToolKind,
    subagentMetadataFromTool: () => undefined, streamErrorText: (e: Error) => e.message,
    stripRawToolMarkup: (s: string) => s,
  });
  assert.deepEqual([...new Set(events.map(t => t.id))], ["todo", "read"]);
  assert.equal(events[0].phase, "preparing");
  assert.equal(events[0].input, undefined);
  const execution = events.find(t => t.id === "todo" && t.phase === "executing");
  assert.equal(execution?.todos?.[0].content, "Inspect");
  assert.equal(events.findLast(t => t.id === "todo")?.status, "completed");
  assert.equal(events.findLast(t => t.id === "read")?.status, "error");
  assert.equal(events.findLast(t => t.id === "read")?.input, '{"path":"/tmp/a"}');
  assert.ok(!JSON.stringify(streams).includes('partial_json'));
  assert.ok(!JSON.stringify(streams).includes('"delta"'));
});


test("final flush publishes pending counts even when input-end is absent", () => {
  const events: ToolInputPart[] = [];
  const progress = createToolInputProgress(t => events.push(t), () => 0);
  progress.start("one", "write_file");
  progress.delta("one", '{"content":');
  progress.flush();
  assert.equal(events.at(-1)?.inputChars, 11);
  assert.equal(events.at(-1)?.phase, "preparing");
  assert.equal(events.at(-1)?.input, undefined);
});
