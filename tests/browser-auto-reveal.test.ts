import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { canAutoRevealBrowser, WORKSPACE_BROWSER_IDLE_MS } from "../lib/browser-auto-reveal";

const source = fs.readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("app-shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) {
  let result: ts.Node | undefined;
  function walk(node: ts.Node) { if (!result && predicate(node)) result = node; ts.forEachChild(node, walk); }
  walk(tree); assert.ok(result); return result!;
}
function evaluate(fn: ts.Node, context: Record<string, unknown>) {
  const js = ts.transpileModule("const callback=" + fn.getText(tree) + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(context), js + ";return callback;")(...Object.values(context));
}
const browserEffect = find(node => ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.arguments[0]?.getText(tree).includes("/api/browser/live?")) as ts.CallExpression;
const defaults = { workspaceOpen: false, workspaceTab: "canvas", hasWorkspaceDocument: false, lastWorkspaceDismissedAt: null as number | null, now: 1000, mobile: false, activeRun: true, blocked: false };
function harness(options: Partial<typeof defaults> & { hidden?: boolean; otherChat?: boolean } = {}) {
  const args = { ...defaults, ...options }, changes: string[] = [], pointers: unknown[] = [];
  const state = { current: { ...args } }, last = { current: args.lastWorkspaceDismissedAt };
  let stream: { onmessage?: (event: { data: string }) => void } | undefined;
  const callback = evaluate(browserEffect.arguments[0], {
    window: {}, document: { visibilityState: options.hidden ? "hidden" : "visible" },
    browserEnabled: true, activeChatId: "chat-1", activeChatIdRef: { current: options.otherChat ? "chat-2" : "chat-1" },
    browserAutoRevealStateRef: state, lastWorkspaceDismissedAtRef: last, canAutoRevealBrowser,
    isMobileChatViewport: () => args.mobile,
    setWorkspaceMounted: (v: boolean) => changes.push("mounted:" + v),
    setWorkspaceOpen: (v: boolean) => changes.push("open:" + v),
    setWorkspaceTab: (v: string) => changes.push("tab:" + v),
    browserAgentPointerRef: { current: { show: (v: unknown) => pointers.push(v), clear: () => {} } },
    setActiveBrowserTabId: () => {}, activeBrowserTabIdRef: { current: "tab-1" },
    setBrowserHistory: () => {}, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ history: [] }) }),
    Date: { now: () => args.now },
    EventSource: function () { const next = { onmessage: undefined as ((event: { data: string }) => void) | undefined, close() {} }; stream = next; return next; },
  });
  const cleanup = callback();
  return { changes, pointers, state, last, cleanup, emit: (type: string, origin = "agent") => stream!.onmessage!({ data: JSON.stringify({ type, source: origin, x: 0.5, y: 0.5, action: "click", tabId: "tab-2" }) }) };
}
test("new chats and empty document panes reveal immediately; occupied tabs keep focus", () => {
  assert.equal(canAutoRevealBrowser(defaults), true);
  for (const workspaceTab of ["canvas", "plan"]) {
    assert.equal(canAutoRevealBrowser({ ...defaults, workspaceOpen: true, workspaceTab }), true);
    assert.equal(canAutoRevealBrowser({ ...defaults, workspaceOpen: true, workspaceTab, hasWorkspaceDocument: true }), false);
  }
  for (const workspaceTab of ["files", "terminal", "memory", "team", "desktops", "monitor", "browser"]) {
    assert.equal(canAutoRevealBrowser({ ...defaults, workspaceOpen: true, workspaceTab }), false);
  }
});
test("explicitly closing the pane retains its cooldown without delaying first use", () => {
  const args = { ...defaults, lastWorkspaceDismissedAt: 1000, now: 1000 + WORKSPACE_BROWSER_IDLE_MS };
  assert.equal(canAutoRevealBrowser({ ...args, now: args.now - 1 }), false);
  assert.equal(canAutoRevealBrowser(args), true);
  assert.equal(canAutoRevealBrowser({ ...args, now: 999 }), false);
  assert.equal(canAutoRevealBrowser({ ...args, lastWorkspaceDismissedAt: NaN }), false);
});
for (const type of ["pointer", "action", "navigation"]) test("actual agent SSE " + type + " respects occupied panes and reveals empty ones", () => {
  for (const workspaceOpen of [false, true]) {
    const eligible = harness({ workspaceOpen }); eligible.emit(type);
    assert.deepEqual(eligible.changes, ["mounted:true", "tab:browser", "open:true"]);
    eligible.emit(type); assert.equal(eligible.changes.length, 3);
  }
  for (const options of [
    { workspaceOpen: true, workspaceTab: "files" }, { workspaceOpen: true, hasWorkspaceDocument: true },
    { lastWorkspaceDismissedAt: 1 }, { mobile: true }, { activeRun: false }, { blocked: true }, { hidden: true }, { otherChat: true },
  ]) {
    const blocked = harness(options); blocked.emit(type); assert.deepEqual(blocked.changes, [], JSON.stringify(options));
  }
  const user = harness(); user.emit(type, "user"); assert.deepEqual(user.changes, []);
});
test("a long pointer session never schedules AppShell state updates", () => {
  const h = harness({ workspaceOpen: true, workspaceTab: "browser" });
  for (let i = 0; i < 18000; i++) h.emit("pointer");
  assert.equal(h.pointers.length, 18000);
  assert.deepEqual(h.changes, []);
});
test("collapsing the pane starts cooldown, switching chat resets it", () => {
  const effect = find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect" && n.arguments[0]?.getText(tree).includes("workspaceWasOpenRef.current")) as ts.CallExpression;
  const last = { current: null as number | null }, wasOpen = { current: true };
  evaluate(effect.arguments[0], { workspaceWasOpenRef: wasOpen, workspaceOpen: false, lastWorkspaceDismissedAtRef: last, Date: { now: () => 400000 } })();
  assert.equal(last.current, 400000);
  const reset = find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect" && n.arguments[0]?.getText(tree).includes("lastWorkspaceDismissedAtRef.current = null")) as ts.CallExpression;
  evaluate(reset.arguments[0], { lastWorkspaceDismissedAtRef: last })();
  assert.equal(last.current, null);
});
test("explicit links still open immediately", () => {
  const declaration = find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === "openLinkedUrl") as ts.VariableDeclaration;
  const changes: string[] = [];
  evaluate(declaration.initializer!, { workspaceLinkRequestRef: { current: 0 }, browserEnabled: true, setWorkspaceTab: (v: string) => changes.push(v), setWorkspaceOpen: (v: boolean) => changes.push(String(v)), openBrowserTabRef: { current: (v: string) => changes.push(v) } })({ detail: "https://example.com/" });
  assert.deepEqual(changes, ["browser", "true", "https://example.com/"]);
});
