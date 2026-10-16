import assert from "node:assert/strict";
import test from "node:test";
import { createGoogle } from "@ai-sdk/google";
import { googleToolSchema, withGoogleToolSchemas } from "../lib/providers/google-tool-schema";
import { ASK_USER_INPUT_SCHEMA } from "../lib/mcp-core/question-schema.mjs";
import { sanitizeJsonSchema } from "../lib/providers/tool-schema";
import { listProviderDefinitions } from "../lib/providers/registry";
import { normalizeAskUserInput } from "../lib/question-contract";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const modelId = listProviderDefinitions().find(provider => provider.key === "google")!.models[0].id;
const canonical = sanitizeJsonSchema(ASK_USER_INPUT_SCHEMA);
const regression = { ...canonical, properties: { ...(canonical.properties as Record<string, unknown>), columns: { type: "integer" as const, enum: [1, 2] } } };
const options = {
  prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "Hallo" }] }],
  tools: [{ type: "function" as const, name: "ask_user", description: "Ask", inputSchema: regression }],
};
function invalidEnums(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(invalidEnums);
  const record = value as Record<string, unknown>;
  return (Array.isArray(record.enum) && record.enum.some(item => typeof item !== "string")) || Object.values(record).some(invalidEnums);
}
const completion = { candidates: [{ content: { role: "model", parts: [{ text: "Hallo!" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
function transport() {
  const bodies: any[] = [];
  const fetcher: typeof fetch = async (url, request) => {
    const body = JSON.parse(String(request?.body)); bodies.push(body);
    if (invalidEnums(body.tools)) return Response.json({ error: { code: 400, message: "Invalid enum value (TYPE_STRING), 1", status: "INVALID_ARGUMENT" } }, { status: 400 });
    if (String(url).includes("streamGenerateContent")) return new Response("data: " + JSON.stringify(completion) + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
    return Response.json(completion);
  };
  return { bodies, fetcher };
}
test("the real Google SDK reproduces the failing numeric enum request before normalization", async () => {
  const f = transport(), model = createGoogle({ apiKey: "test", fetch: f.fetcher }).chat(modelId);
  await assert.rejects(async () => await model.doGenerate(options), /TYPE_STRING/);
  assert.deepEqual(f.bodies[0].tools[0].functionDeclarations[0].parameters.properties.columns.enum, [1, 2]);
});
for (const mode of ["generate", "stream"] as const) {
  test(`Google SDK ${mode} serializes the canonical ask_user schema without numeric enums`, async () => {
    const f = transport(), original = JSON.stringify(options);
    const model = withGoogleToolSchemas(createGoogle({ apiKey: "test", fetch: f.fetcher }).chat(modelId));
    if (mode === "generate") {
      const result = await model.doGenerate(options);
      assert.ok(result.content.some(part => part.type === "text" && part.text === "Hallo!"));
    } else {
      const result = await model.doStream(options);
      const reader = result.stream.getReader(), parts: any[] = [];
      for (;;) { const item = await reader.read(); if (item.done) break; parts.push(item.value); }
      assert.ok(parts.some(part => part.type === "text-delta" && part.delta === "Hallo!"));
    }
    const columns = f.bodies[0].tools[0].functionDeclarations[0].parameters.properties.columns;
    assert.equal(columns.type, "integer");
    assert.equal(columns.enum, undefined);
    assert.match(columns.description, /\[1,2\]/);
    assert.equal(invalidEnums(f.bodies[0].tools), false);
    assert.equal(JSON.stringify(options), original);
    assert.deepEqual((options.tools[0].inputSchema.properties.columns as { enum: number[] }).enum, [1, 2]);
  });
}

test("nested enums, non-string consts and mixed enums are normalized without rewriting values or unrelated data", () => {
  const schema = {
    type: "object", required: ["count"], properties: {
      count: { type: "integer", enum: [1, 3], description: "Count", default: 1 },
      flags: { type: "array", items: { type: "boolean", enum: [true, false] } },
      choice: { anyOf: [{ type: "number", const: 2 }, { type: "string", enum: ["a", "b"] }] },
      mixed: { enum: ["one", 1, null] },
      literal: { type: "string", const: "fixed" },
      payload: { type: "object", default: { enum: [7] } },
    },
  };
  const before = JSON.stringify(schema), next: any = googleToolSchema(schema);
  assert.equal(next.properties.count.type, "integer");
  assert.equal(next.properties.count.default, 1);
  assert.equal(next.properties.count.enum, undefined);
  assert.match(next.properties.count.description, /Count.*\[1,3\]/);
  assert.equal(next.properties.flags.items.enum, undefined);
  assert.equal(next.properties.choice.anyOf[0].const, undefined);
  assert.deepEqual(next.properties.choice.anyOf[1].enum, ["a", "b"]);
  assert.equal(next.properties.mixed.enum, undefined);
  assert.equal(next.properties.literal.const, "fixed");
  assert.deepEqual(next.properties.payload.default, { enum: [7] });
  assert.equal(JSON.stringify(schema), before);
});


test("the shared ask_user schema is compatible with native Gemini clients and keeps numeric 1-or-2 validation", async () => {
  const f = transport(), model = createGoogle({ apiKey: "test", fetch: f.fetcher }).chat(modelId);
  await model.doGenerate({ ...options, tools: [{ ...options.tools[0], inputSchema: canonical }] });
  assert.equal(invalidEnums(f.bodies[0].tools), false);
  const form = { questions: [{ question: "Test", type: "text" }] };
  for (const columns of [1, 2]) assert.equal(normalizeAskUserInput({ ...form, columns }).columns, columns);
  for (const columns of [0, 3, 1.5, "1", "2"]) assert.throws(() => normalizeAskUserInput({ ...form, columns }));
});

test("Google and Vertex routing apply the same wrapper while other providers keep their schemas", () => {
  const source = ts.createSourceFile("provider-support.ts", readFileSync("lib/providers/adapters/provider-support.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let declaration = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "aiModel") declaration = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(declaration);
  const raw = { provider: "test", specificationVersion: "v4" };
  const wrapped: unknown[] = [];
  const provider = () => ({ chat: () => raw, messages: () => raw, languageModel: () => raw });
  const js = ts.transpileModule(declaration.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const aiModel = vm.runInNewContext(js + "; aiModel", {
    createGoogle: provider, createGoogleVertex: provider, createAnthropic: provider,
    withGoogleToolSchemas: (model: unknown) => { wrapped.push(model); return { model }; },
  });
  const connection = { secret: "test", config: {} };
  aiModel("google", modelId, connection);
  aiModel("google", modelId, { ...connection, authType: "vertex_adc" });
  assert.equal(wrapped.length, 2);
  assert.equal(aiModel("anthropic", "test-model", connection), raw);
  assert.equal(wrapped.length, 2);
});
