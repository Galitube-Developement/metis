import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { parseModelKey as parseAccountModelKey } from "../lib/providers/types";
import { modelForSelection } from "../lib/model-selection";
import type { ProjectModelSelection } from "../lib/project-model";
import { modelParametersForModel, sanitizeModelParams } from "../lib/model-params";

const source = ts.createSourceFile("app-shell.tsx", readFileSync("components/app-shell.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "selectModel") handler = node;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const js = ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
type Params = ProjectModelSelection["modelParams"];
type ModelSelectionRequest = {
  version: number;
  chatId: string | null;
  chatVersion: number;
  pending: boolean;
  confirmed: ProjectModelSelection;
};
function fixture(chatId: string | null = "chat") {
  const calls: Array<{ url: string; body: ProjectModelSelection; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  const errors: string[] = [];
  const storage = new Map<string, string>();
  const context = {
    Error, modelForSelection, projectModel: null as ProjectModelSelection | null, modelId: "p/a", modelParams: [{ id: "effort", value: "low" }] as Params,
    modelParamsByModel: {} as Record<string, Params>, lastModelByProvider: {} as Record<string, string>,
    models: ["p/b", "p/c"].map(id => ({ id, defaultParams: [{ id: "effort", value: "high" }] })),
    activeChatIdRef: { current: chatId }, chatLoadRequestRef: { current: 1 },
    modelSelectionRequestRef: { current: null as ModelSelectionRequest | null },
    parseModelKey: (id: string) => ({ providerKey: id.split("/")[0] }),
    MODEL_STORAGE_KEY: "model", PARAMS_STORAGE_KEY: "params",
    localStorage: { setItem: (key: string, value: string) => storage.set(key, value) },
    setModelId: (id: string) => { context.modelId = id; },
    setModelParams: (params: Params) => { context.modelParams = params; },
    setModelParamsByModel: (map: Record<string, Params>) => { context.modelParamsByModel = map; },
    setLastModelByProvider: (map: Record<string, string>) => { context.lastModelByProvider = map; },
    toast: { error: (message: string) => errors.push(message) },
    fetch: (url: string, init: { body: string }) => {
      if (url === "/api/preferences") return Promise.resolve(Response.json({}));
      return new Promise<Response>((resolve, reject) => calls.push({ url, body: JSON.parse(init.body) as ProjectModelSelection, resolve, reject }));
    },
  };
  const select = vm.runInNewContext(js + "; selectModel", context) as (id: string) => Promise<void>;
  return { context, select, calls, errors, storage };
}
const success = (modelId: string, modelParams: Params = []) => Response.json({ chat: { modelId, modelParams } });

test("failed HTTP and network restore the confirmed model and params with a toast", async () => {
  for (const failure of ["http", "network"]) {
    const f = fixture();
    const before = f.context.modelParams;
    const pending = f.select("p/b");
    assert.equal(f.context.modelId, "p/b");
    if (failure === "http") f.calls[0].resolve(Response.json({ error: "denied" }, { status: 500 }));
    else f.calls[0].reject(new Error("Network unavailable"));
    await pending;
    assert.equal(f.context.modelId, "p/a");
    assert.deepEqual(f.context.modelParams, before);
    assert.equal(f.storage.get("model"), "p/a");
    assert.equal(f.errors.length, 1);
  }
});

test("successful PATCH applies canonical server model and params, then becomes rollback baseline", async () => {
  const f = fixture();
  const canonical = [{ id: "effort", value: "canonical" }];
  const first = f.select("p/b");
  f.calls[0].resolve(success("p/canonical", canonical));
  await first;
  assert.equal(f.context.modelId, "p/canonical");
  assert.deepEqual(f.context.modelParams, canonical);
  assert.equal(f.storage.get("params"), JSON.stringify(canonical));
  assert.equal(f.context.lastModelByProvider.p, "p/canonical");
  const second = f.select("p/c");
  f.calls[1].reject(new Error("offline"));
  await second;
  assert.equal(f.context.modelId, "p/canonical");
  assert.deepEqual(f.context.modelParams, canonical);
});

test("rapid A to B to C ignores delayed obsolete successes and failures", async () => {
  for (const obsoleteFailure of [false, true]) {
    const f = fixture();
    const b = f.select("p/b");
    const c = f.select("p/c");
    f.calls[1].resolve(success("p/c"));
    await c;
    if (obsoleteFailure) f.calls[0].reject(new Error("late failure"));
    else f.calls[0].resolve(success("p/b"));
    await b;
    assert.equal(f.context.modelId, "p/c");
    assert.equal(f.storage.get("model"), "p/c");
    assert.equal(f.errors.length, 0);
  }
});

test("overlapping failures roll back to A rather than optimistic B", async () => {
  const f = fixture();
  const b = f.select("p/b");
  const c = f.select("p/c");
  f.calls[1].reject(new Error("C failed"));
  await c;
  assert.equal(f.context.modelId, "p/a");
  f.calls[0].resolve(success("p/b"));
  await b;
  assert.equal(f.context.modelId, "p/a");
  assert.equal(f.errors.length, 1);
});

test("chat changes and returning to the same chat invalidate pending responses", async () => {
  for (const returnToChat of [false, true]) {
    for (const fail of [false, true]) {
      const f = fixture();
      const pending = f.select("p/b");
      f.context.activeChatIdRef.current = returnToChat ? "chat" : "other";
      f.context.chatLoadRequestRef.current++;
      f.context.modelId = "p/other";
      if (fail) f.calls[0].reject(new Error("old chat failure"));
      else f.calls[0].resolve(success("p/b"));
      await pending;
      assert.equal(f.context.modelId, "p/other");
      assert.equal(f.errors.length, 0);
    }
  }
});

test("chat switch while response JSON is pending cannot overwrite the new selection", async () => {
  const f = fixture();
  let finish!: (data: unknown) => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const pending = f.select("p/b");
  f.calls[0].resolve({ ok: true, json: () => new Promise(resolve => { finish = resolve; started(); }) } as Response);
  await reading;
  f.context.activeChatIdRef.current = "other";
  f.context.modelId = "p/other";
  finish({ chat: { modelId: "p/b", modelParams: [] } });
  await pending;
  assert.equal(f.context.modelId, "p/other");
});

test("draft selections remain local without a chat PATCH; project lock stays effective", async () => {
  const f = fixture(null);
  await f.select("p/b");
  assert.equal(f.calls.length, 0);
  assert.equal(f.context.modelId, "p/b");
  assert.equal(f.storage.get("model"), "p/b");
  f.context.projectModel = { modelId: "p/b", modelParams: f.context.modelParams };
  await f.select("p/c");
  assert.equal(f.context.modelId, "p/b");
});

test("new-chat selection remembers the same model separately for each provider account", async () => {
  const f=fixture(null);
  f.context.parseModelKey=parseAccountModelKey;
  await f.select("codex:personal:shared-model");
  await f.select("codex:work:shared-model");
  assert.equal(f.context.lastModelByProvider["codex:personal"],"codex:personal:shared-model");
  assert.equal(f.context.lastModelByProvider["codex:work"],"codex:work:shared-model");
  assert.equal(f.context.modelId,"codex:work:shared-model");
  assert.equal(f.storage.get("model"),"codex:work:shared-model");
});

test("legacy keys recover the active account's advertised reasoning contract without changing identity", () => {
  const a = { id: "codex:personal:shared", parameters: [{ id: "effort", values: [{ value: "personal-effort" }] }] };
  const b = { id: "codex:work:shared", legacyIds: ["codex:shared"], parameters: [{ id: "effort", values: [{ value: "work-effort" }] }] };
  const models = [a, b];
  const legacy = modelForSelection(models, "codex:shared");
  assert.equal(legacy, b);
  assert.equal(modelForSelection([...models].reverse(), "codex:shared"), b, "list order must not choose an account");
  assert.deepEqual(modelParametersForModel(legacy!), b.parameters.map(p => ({ ...p, displayName: "Reasoning" })));
  assert.deepEqual(sanitizeModelParams(legacy!, [{ id: "effort", value: "work-effort" }, { id: "effort", value: "personal-effort" }]), [{ id: "effort", value: "work-effort" }]);
  assert.equal(modelForSelection(models, a.id), a, "an explicit selection keeps its own account contract");
  assert.equal(modelForSelection(models, "codex:removed:shared"), undefined);
  assert.equal(modelForSelection(models, "openai:shared"), undefined);
});

test("metadata aliases stay explicit, unique and preserve opaque provider-native IDs", () => {
  const model = { id: "ollama:local:fixture:tag", legacyIds: ["ollama:fixture:tag"] };
  assert.equal(modelForSelection([model], "ollama:fixture:tag"), model);
  assert.equal(modelForSelection([{ id: "fixture:scoped", legacyIds: ["raw-model"] }], "raw-model")?.id, "fixture:scoped");
  assert.equal(modelForSelection([{ id: "codex:work:shared" }], "codex:shared"), undefined, "no inferred aliases");
  assert.equal(modelForSelection([{ id: "a", legacyIds: ["legacy"] }, { id: "b", legacyIds: ["legacy"] }], "legacy"), undefined);
  const exact = { id: "legacy" };
  assert.equal(modelForSelection([model, { id: "b", legacyIds: ["legacy"] }, exact], "legacy"), exact);
  assert.equal(modelForSelection([model], ""), undefined);
  assert.equal(modelForSelection([model], undefined), undefined);
});

test("the real selection callback loads defaults through a legacy alias and preserves its saved key", async () => {
  const f = fixture(null);
  const meta = { id: "cursor:account:legacy", legacyIds: ["legacy"], defaultParams: [{ id: "effort", value: "live-advertised" }] };
  f.context.models = [meta];
  await f.select("legacy");
  assert.equal(f.context.modelId, "legacy");
  assert.deepEqual(f.context.modelParams, meta.defaultParams);
  assert.equal(f.storage.get("model"), "legacy");
});
