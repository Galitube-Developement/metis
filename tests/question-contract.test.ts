import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import {
  normalizeAskUserInput, normalizeQuestionAnswers, normalizeStoredQuestions,
  initialQuestionAnswers, previewQuestionValues, questionSummary, restoreQuestionDraft,
  QuestionValidationError, type AgentQuestion, type AskUserInput,
} from "../lib/question-contract";
import { remarkChatIcons } from "../lib/markdown-icons";
import { ASK_USER_INPUT_SCHEMA, QUESTION_TYPES, QUESTION_ICONS } from "../lib/mcp-core/question-schema.mjs";
import { sanitizeJsonSchema } from "../lib/providers/tool-schema";
function form(input: AskUserInput) {
  const normalized = normalizeAskUserInput(input);
  const questions = normalized.questions.map((q, i) => ({ ...q, id: String(i) })) as AgentQuestion[];
  return { ...normalized, questions, questionId: "fixture" };
}
test("legacy single, multiple and free-text questions share one contract", () => {
  const f = form({ questions: [
    { question: "Choice", options: ["A", "B"] }, { question: "Many", multiple: true, options: ["A", "B"] }, { question: "Explain" },
  ] });
  assert.deepEqual(f.questions.map(q => q.type), ["radio", "multiselect", "textarea"]);
  assert.ok(f.questions.every(q => q.allowCustom));
  const result = normalizeQuestionAnswers(f.questions, ["B", '["A","B"]', " Hello "]);
  assert.deepEqual(result.answers, ["B", '["A","B"]', "Hello"]);
  assert.deepEqual({ ...result.values }, { question_1: "B", question_2: ["A", "B"], question_3: "Hello" });
});
test("monitor example returns typed values and readable option labels", () => {
  const f = form({ title: "Monitor diagnosis", responseTemplate: "Monitors: {{monitor1}} and {{monitor2}}. Result: {{result}}.", questions: [
    { key: "monitor1", question: "Monitor 1", type: "select", options: [{ label: "60 Hz", value: 60 }, { label: "144 Hz", value: 144 }] },
    { key: "monitor2", question: "Monitor 2", type: "select", options: [{ label: "60 Hz", value: 60 }] },
    { key: "result", question: "Test result", type: "radio", options: [{ label: "Still at 40%", value: "unchanged" }] },
  ] });
  const result = normalizeQuestionAnswers(f.questions, { monitor1: 144, monitor2: 60, result: "unchanged" });
  assert.deepEqual({ ...result.values }, { monitor1: 144, monitor2: 60, result: "unchanged" });
  assert.equal(questionSummary(f, f.questions, result.values), "Monitors: 144 Hz and 60 Hz. Result: Still at 40%.");
});
test("false, zero and empty optional fields survive without becoming missing answers", () => {
  const f = form({ questions: [
    { key: "enabled", question: "Enabled?", type: "checkbox" },
    { key: "count", question: "Count", type: "number", min: 0 },
    { key: "comment", question: "Comment", type: "text", required: false },
  ] });
  assert.deepEqual({ ...normalizeQuestionAnswers(f.questions, { enabled: false, count: 0 }).values }, { enabled: false, count: 0, comment: null });
});
test("hidden conditional fields discard forged values and do not block submission", () => {
  const f = form({ questions: [
    { key: "mode", question: "Mode", type: "radio", options: ["simple", "advanced"] },
    { key: "detail", question: "Details", type: "number", min: 1, showWhen: { key: "mode", equals: "advanced" } },
    { key: "more", question: "Follow up", type: "text", showWhen: { key: "detail", equals: 5 } },
  ] });
  assert.deepEqual({ ...normalizeQuestionAnswers(f.questions, { mode: "simple", detail: 5, more: "forged" }).values }, { mode: "simple", detail: null, more: null });
  assert.throws(() => normalizeQuestionAnswers(f.questions, { mode: "advanced" }), QuestionValidationError);
  assert.deepEqual({ ...previewQuestionValues(f.questions, ["simple", "5", "ignored"]) }, { mode: "simple", detail: null, more: null });
});
test("multiselect conditions and custom values stay typed", () => {
  const f = form({ questions: [
    { key: "choices", question: "Choices", type: "multiselect", options: [{ label: "One", value: 1 }, { label: "Yes", value: true }], allowCustom: true },
    { key: "detail", question: "Details", type: "text", showWhen: { key: "choices", equals: true } },
  ] });
  assert.deepEqual({ ...normalizeQuestionAnswers(f.questions, { choices: [1, true, "Other"], detail: "OK" }).values }, { choices: [1, true, "Other"], detail: "OK" });
  assert.throws(() => normalizeQuestionAnswers(f.questions, { choices: [1, 1] }), QuestionValidationError);
});
test("number, slider, date, time and text bounds are enforced on the server contract", () => {
  const cases: Array<[AskUserInput["questions"][number], unknown]> = [
    [{ question: "Count", type: "number", min: 0, max: 10, step: 2 }, 3],
    [{ question: "Count", type: "number" }, Infinity],
    [{ question: "Count", type: "number" }, true],
    [{ question: "Date", type: "date" }, "2026-02-30"],
    [{ question: "Time", type: "time" }, "24:00"],
    [{ question: "Text", type: "text", maxLength: 3 }, "four"],
    [{ question: "Choice", type: "select", options: ["A"] }, "forged"],
  ];
  for (const [question, value] of cases) {
    const f = form({ questions: [{ ...question, key: "field" }] });
    assert.throws(() => normalizeQuestionAnswers(f.questions, { field: value }), QuestionValidationError);
  }
  const f = form({ questions: [{ key: "n", question: "N", type: "slider", min: 0, max: 1, step: 0.1 }, { key: "d", question: "D", type: "date" }, { key: "t", question: "T", type: "time" }] });
  assert.deepEqual({ ...normalizeQuestionAnswers(f.questions, { n: 0.3, d: "2026-10-10", t: "23:59" }).values }, { n: 0.3, d: "2026-10-10", t: "23:59" });
});
test("invalid schemas, duplicate keys, ambiguous options and cyclic dependencies are rejected", () => {
  const inputs = [
    { questions: [{ question: "A", key: "same" }, { question: "B", key: "same" }] },
    { questions: [{ question: "A", key: "constructor" }] },
    { questions: [{ question: "A", type: "select" }] },
    { questions: [{ question: "A", type: "slider", min: 0 }] },
    { questions: [{ question: "A", min: 10, max: 0 }] },
    { questions: [{ question: "A", type: "radio", multiple: true, options: ["A"] }] },
    { questions: [{ question: "A", options: [{ label: "One", value: 1 }, { label: "String", value: "1" }] }] },
    { questions: [{ question: "A", key: "a", showWhen: { key: "b", equals: true } }, { question: "B", key: "b" }] },
    { questions: [{ question: "A", icon: "arbitrary-script" }] },
    { questions: [{ question: " " }] },
    { questions: [{ question: "A" }], responseTemplate: "{{missing}}" },
    { questions: [{ question: "A", unexpected: "x" }] },
  ];
  for (const input of inputs) assert.throws(() => normalizeAskUserInput(input));
});
test("defaults are validated and serialized without automatic submission", () => {
  const f = form({ questions: [
    { question: "Number", type: "number", default: 0 },
    { question: "Toggle", type: "toggle" },
    { question: "Slider", type: "slider", min: 5, max: 10 },
    { question: "Choices", type: "multiselect", options: ["A"], default: ["A"] },
  ] });
  assert.deepEqual(initialQuestionAnswers(f.questions), ["0", "false", "5", '["A"]']);
  assert.throws(() => form({ questions: [{ question: "N", type: "number", min: 10, default: 5 }] }));
});
test("same-form drafts survive reload while old-form drafts cannot leak into a new request", () => {
  const f = form({ questions: [{ question: "N", type: "number", default: 5 }] });
  const extra = { questionDraftId: "fixture", questionAnswers: ["9"], questionCustom: ["custom"], questionCustomActive: [true] };
  assert.deepEqual(restoreQuestionDraft(f, extra), { answers: ["9"], custom: ["custom"], customActive: [true] });
  assert.deepEqual(restoreQuestionDraft({ ...f, questionId: "next" }, extra), { answers: ["5"], custom: [""], customActive: [false] });
});
test("SSE normalization preserves field metadata and stored IDs", () => {
  const fields = normalizeStoredQuestions([{ id: "stored", question: "Count", key: "count", type: "number", min: 0, icon: "cpu" }]);
  assert.equal(fields[0].id, "stored"); assert.equal(fields[0].key, "count"); assert.equal(fields[0].min, 0); assert.equal(fields[0].icon, "cpu");
});
test("provider schema sanitization retains all modular fields and typed option unions", () => {
  type Schema = { properties: { questions: { items: { properties: { type: { enum: string[] }; icon: { enum: string[] }; options: { items: { anyOf: Array<{ properties: { value: { anyOf: Array<{ type: string }> } } }> } } } } }; responseTemplate: { type: string } } };
  const schema = sanitizeJsonSchema(ASK_USER_INPUT_SCHEMA) as Schema;
  const fields = schema.properties.questions.items.properties;
  assert.deepEqual(fields.type.enum, QUESTION_TYPES);
  assert.deepEqual(fields.icon.enum, QUESTION_ICONS);
  assert.equal(fields.options.items.anyOf[1].properties.value.anyOf[1].type, "number");
  assert.equal(schema.properties.responseTemplate.type, "string");
});
test("icons render in headings and prose but leave code and unknown tokens intact", () => {
  const source = "# [icon:monitor] Display\n\n[icon:settings] Configure [icon:unknown].\n\n`[icon:cpu]`\n\n~~~text\n[icon:cpu]\n~~~";
  const tree = unified().use(remarkParse).parse(source);
  type Node = { type: string; value?: string; children?: Node[]; data?: { hProperties: Record<string, string> } };
  const transformed = unified().use(remarkChatIcons).runSync(tree) as Node;
  const all: Node[] = [];
  function collect(node: Node) { all.push(node); node.children?.forEach(collect); }
  collect(transformed);
  assert.deepEqual(all.filter(n => n.type === "metisIcon").map(n => n.data!.hProperties["data-metis-icon"]), ["monitor", "settings"]);
  assert.ok(all.some(n => n.type === "inlineCode" && n.value === "[icon:cpu]"));
  assert.ok(all.some(n => n.type === "code" && n.value === "[icon:cpu]"));
  assert.ok(all.some(n => n.type === "text" && n.value?.includes("[icon:unknown]")));
});
