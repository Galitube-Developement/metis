import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (n: ts.Node) => boolean) { let found: ts.Node | undefined; function walk(n: ts.Node) { if (!found && predicate(n)) found = n; ts.forEachChild(n, walk); } walk(tree); assert.ok(found); return found!; }
function evaluate(fn: ts.Node, context: Record<string, unknown>) { const js = ts.transpileModule("const callback=" + fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; return new Function(...Object.keys(context), js + ";return callback;")(...Object.values(context)); }
const effect = find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect" && n.arguments[0]?.getText(tree).includes("/api/browser/stream?")) as ts.CallExpression;
function harness(visible = true) {
  const frames: unknown[] = [], sockets: Array<{onmessage?: (e: { data: unknown }) => void; onclose?: () => void; close: () => void; closed?: boolean}> = [];
  let disposed = 0, ready: (() => void) | undefined;
  const socketRef = { current: null as unknown };
  const presenterRef = { current: null as unknown };
  const noop = () => {};
  const context: Record<string, unknown> = {
    browserStreamVisible: visible, browserEnabled: true, activeChatId: "chat", loadingChatId: null,
    browserScreenshotRef: { current: {} }, browserFramePresenterRef: presenterRef,
    createBrowserFramePresenter: (_: unknown, onFrame: () => void) => { ready = onFrame; return { push: (frame: unknown) => frames.push(frame), dispose: () => disposed++ }; },
    markBrowserFrameVisible: noop, beginBrowserLoading: noop, clearBrowserFrame: noop,
    browserUrlRef: { current: "" }, activeBrowserTabId: "browser-1", activeBrowserTabIdRef: { current: "browser-1" },
    browserRealtime: true, browserFps: 30, browserDefaultViewport: { width: 1280, height: 800 },
    browserSocketRef: socketRef, browserLoadingRef: { current: false },
    window: { location: { protocol: "http:", host: "test" }, setTimeout: () => 1, clearTimeout: noop },
    URLSearchParams, Blob,
    WebSocket: function () { const socket = { close() { this.closed = true; }, closed: false }; sockets.push(socket); return socket; },
    setBrowserLoading: noop, setBrowserError: noop,
  };
  const cleanup = evaluate(effect.arguments[0], context)();
  return { sockets, socketRef, presenterRef, frames, cleanup, get disposed() { return disposed; }, ready: () => ready?.() };
}
test("visibility contract excludes collapsed panes, other tabs, account/notebooks and hidden documents", () => {
  const decl = find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === "browserStreamVisible") as ts.VariableDeclaration;
  const base = { workspaceOpen: true, workspaceMounted: true, workspaceTab: "browser", accountView: null, notesOpen: false, automationsOpen: false, projectHomeId: null, browserDocumentVisible: true };
  const js = ts.transpileModule("const callback=()=>(" + decl.initializer!.getText(tree) + ");", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const visible = (values: Record<string, unknown>) => new Function(...Object.keys(values), js + ";return callback();")(...Object.values(values));
  assert.equal(visible(base), true);
  for (const patch of [{ workspaceOpen: false }, { workspaceMounted: false }, { workspaceTab: "files" }, { accountView: "settings" }, { notesOpen: true }, { automationsOpen: true }, { projectHomeId: "project" }, { browserDocumentVisible: false }]) assert.equal(visible({ ...base, ...patch }), false);
});
test("hidden browser never connects; teardown disposes frames and stale messages cannot paint", () => {
  assert.equal(harness(false).sockets.length, 0);
  const h = harness();
  assert.equal(h.sockets.length, 1);
  const socket = h.sockets[0], blob = new Blob(["frame"]);
  socket.onmessage!({ data: blob }); assert.equal(h.frames[0], blob);
  h.cleanup(); assert.equal(h.disposed, 1); assert.equal(socket.closed, true); assert.equal(h.presenterRef.current, null);
  socket.onmessage!({ data: new Blob(["late"]) }); assert.equal(h.frames.length, 1);
});
