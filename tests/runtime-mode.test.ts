import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import type { ToolPermissionCategory } from "@/lib/store";

import {
  approvalPatternFor,
  DEFAULT_RUNTIME_MODE,
  normalizeRuntimeMode,
  RUNTIME_MODES,
  RUNTIME_MODE_TO_CLAUDE_PERMISSION,
  RUNTIME_MODE_TO_CODEX,
  runtimeModeForChat,
  runtimeModeRequiresApproval,
  shouldAutoApprove,
} from "../lib/runtime-mode";

const dataDir = path.join(os.tmpdir(), `metis-runtime-mode-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.AI_CHAT_INTERNAL_ORIGIN ||= "http://127.0.0.1:1";

const modulesPromise = Promise.all([
  import("../lib/db-approvals"),
  import("../lib/db-store"),
]);

let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("normalizeRuntimeMode accepts only the complete runtime mode set", () => {
  for (const mode of RUNTIME_MODES)
    assert.equal(normalizeRuntimeMode(mode), mode);
  assert.equal(normalizeRuntimeMode("unknown"), DEFAULT_RUNTIME_MODE);
  assert.equal(normalizeRuntimeMode(undefined), DEFAULT_RUNTIME_MODE);
  assert.equal(normalizeRuntimeMode(42), DEFAULT_RUNTIME_MODE);
  assert.equal(runtimeModeForChat({ runtimeMode: "auto" }), "auto");
  assert.equal(runtimeModeForChat({ runtimeMode: null }), DEFAULT_RUNTIME_MODE);
});

test("every runtime mode has complete provider mappings", () => {
  assert.deepEqual(
    RUNTIME_MODES.map((mode) => RUNTIME_MODE_TO_CODEX[mode]?.sandboxMode),
    ["workspace-write", "workspace-write", "workspace-write", "danger-full-access"],
  );
  assert.deepEqual(
    RUNTIME_MODES.map((mode) => RUNTIME_MODE_TO_CODEX[mode]?.approvalPolicy),
    ["never", "never", "never", "never"],
  );
  assert.deepEqual(
    RUNTIME_MODES.map(
      (mode) => RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]?.permissionMode,
    ),
    ["default", "acceptEdits", "auto", "bypassPermissions"],
  );
  assert.deepEqual(
    RUNTIME_MODES.map(
      (mode) => RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]?.canUseToolRequired,
    ),
    [true, true, true, false],
  );
  for (const mode of RUNTIME_MODES) {
    assert.ok(RUNTIME_MODE_TO_CODEX[mode]);
    assert.ok(RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]);
  }
});

test("approvals round-trip and cannot be resolved twice", async () => {
  const {
    consumeApprovalGrant,
    createApproval,
    expireApproval,
    getApproval,
    heartbeatApproval,
    resolveApproval,
  } = modules[0];
  const { createChat } = modules[1];
  const chat = createChat("Runtime approval");
  const scope = approvalPatternFor("execute_command", { command: "pnpm test" });
  const { approvalId } = createApproval({
    jobId: "job-1",
    chatId: chat.id,
    title: "Command approval required",
    command: "pnpm test",
    sessionScope: scope,
  });
  assert.ok(heartbeatApproval(approvalId));
  const pending = getApproval(approvalId);
  assert.equal(pending?.status, "waiting_for_user");
  const resolved = resolveApproval(approvalId, "allow");
  assert.equal(resolved?.chatId, chat.id);
  assert.equal(getApproval(approvalId)?.status, "resolved");
  assert.equal(getApproval(approvalId)?.decision, "allow");
  assert.equal(resolved?.sessionScope, scope);
  assert.equal(consumeApprovalGrant({
    jobId: "job-1",
    chatId: chat.id,
    sessionScope: scope,
  }), true);
  assert.equal(consumeApprovalGrant({
    jobId: "job-1",
    chatId: chat.id,
    sessionScope: scope,
  }), false);
  assert.equal(resolveApproval(approvalId, "deny"), null);
  const expired = createApproval({
    jobId: "job-2",
    chatId: chat.id,
    title: "Expiring approval",
  });
  assert.equal(expireApproval(expired.approvalId)?.decision, "deny");
  assert.equal(getApproval(expired.approvalId)?.decision, "deny");
  assert.equal(resolveApproval(expired.approvalId, "allow"), null);
});

test("chat persistence normalizes runtime mode and session approvals keep their canonical scope", async () => {
  const { createApproval, getApproval, resolveApproval } = modules[0];
  const { createChat, getChat, updateChat } = modules[1];
  const chat = createChat("Runtime persistence");
  updateChat(chat.id, { runtimeMode: "not-a-mode" });
  assert.equal(getChat(chat.id)?.runtimeMode, undefined);
  updateChat(chat.id, { runtimeMode: "approval-required" });
  assert.equal(getChat(chat.id)?.runtimeMode, "approval-required");
  updateChat(chat.id, { sessionState: { goal: "  Ship the feature  " } });
  assert.equal(getChat(chat.id)?.sessionState?.goal, "Ship the feature");
  updateChat(chat.id, { sessionState: { goal: null } });
  assert.equal(getChat(chat.id)?.sessionState?.goal, undefined);

  const scope = approvalPatternFor("write_file", { path: "/tmp/a/b" });
  const { approvalId } = createApproval({
    chatId: chat.id,
    title: "Write approval",
    sessionScope: scope,
  });
  const resolved = resolveApproval(approvalId, "allow-session");
  assert.equal(resolved?.sessionScope, scope);
  assert.equal(getApproval(approvalId)?.sessionScope, scope);
});

test("session prefix decisions auto-approve only matching tool input prefixes", () => {
  const pattern = approvalPatternFor("execute_command", {
    command: "pnpm test",
  });
  assert.equal(
    shouldAutoApprove([pattern], "execute_command", { command: "pnpm test" }),
    true,
  );
  assert.equal(
    shouldAutoApprove([pattern.slice(0, -1)], "execute_command", {
      command: "pnpm test",
    }),
    true,
  );
  assert.equal(
    shouldAutoApprove([pattern], "execute_command", { command: "npm test" }),
    false,
  );
  assert.equal(
    shouldAutoApprove([pattern], "write_file", { command: "pnpm test" }),
    false,
  );
  assert.equal(
    shouldAutoApprove([], "execute_command", { command: "pnpm test" }),
    false,
  );
});

test("runtime approval gate covers terminal and write tools only in approval mode", async () => {
  assert.equal(
    runtimeModeRequiresApproval("approval-required", "terminal"),
    true,
  );
  assert.equal(runtimeModeRequiresApproval("approval-required", "write"), true);
  assert.equal(runtimeModeRequiresApproval("approval-required", "read"), false);
  assert.equal(runtimeModeRequiresApproval("auto-accept-edits", "terminal"), true);
  assert.equal(runtimeModeRequiresApproval("auto-accept-edits", "write"), false);
  assert.equal(runtimeModeRequiresApproval("auto", "terminal"), false);
  assert.equal(runtimeModeRequiresApproval("full-access", "terminal"), false);
  // The package re-exports the same pure gate used by gateway dispatch.
  // @ts-expect-error — untyped .mjs re-export; shapes verified by assertions below.
  const gateway = (await import("../packages/mcp-gateway/index.mjs")) as {
    modeToolCategory: (name: string) => string;
    runtimeModeRequiresApproval: typeof runtimeModeRequiresApproval;
    shouldAutoApprove: typeof shouldAutoApprove;
  };
  assert.equal(gateway.modeToolCategory("execute_command"), "terminal");
  assert.equal(gateway.modeToolCategory("write_file"), "write");
  assert.equal(
    gateway.runtimeModeRequiresApproval(
      "approval-required",
      gateway.modeToolCategory("execute_command") as ToolPermissionCategory,
    ),
    true,
  );
  assert.equal(
    gateway.runtimeModeRequiresApproval(
      "auto-accept-edits",
      gateway.modeToolCategory("execute_command") as ToolPermissionCategory,
    ),
    true,
  );
  assert.equal(gateway.runtimeModeRequiresApproval("auto-accept-edits", "write"), false);
  assert.equal(gateway.runtimeModeRequiresApproval("auto", "terminal"), false);
  assert.equal(
    gateway.runtimeModeRequiresApproval(
      "full-access",
      gateway.modeToolCategory("execute_command") as ToolPermissionCategory,
    ),
    false,
  );
  assert.equal(
    gateway.shouldAutoApprove(
      [approvalPatternFor("write_file", { path: "/tmp/a/b" })],
      "execute_command",
      { command: "pnpm test" },
    ),
    false,
  );
  // The gateway's local prefix format is identical to lib/runtime-mode.ts.
  assert.equal(
    gateway.shouldAutoApprove(
      ['write_file:{"path":"/tmp/a/b"}'],
      "write_file",
      { path: "/tmp/a/b" },
    ),
    true,
  );
});

test("gateway deny prevents a file edit before execution", async () => {
  // @ts-expect-error — the gateway's JavaScript module has no declaration file.
  const gateway = (await import("../packages/mcp-gateway/index.mjs")) as {
    dispatchGatewayTool: (name: string, args: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
  };
  const target = path.join(dataDir, "denied-edit.txt");
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests += 1;
    const url = String(input);
    const body = init?.method === "POST"
      ? { approvalId: "test-approval" }
      : url.includes("?id=")
        ? { status: "resolved", decision: "deny" }
        : { approvedPatterns: [], approvedOnce: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await gateway.dispatchGatewayTool("write_file", { path: target, content: "must not be written" }, {
      auditCall: false,
      context: { runtimeMode: "approval-required", chatId: "chat-test", jobId: "job-test" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text || "", /denied/i);
    assert.equal(existsSync(target), false);
    assert.equal(requests, 3);
    const terminalTarget = path.join(dataDir, "denied-command.txt");
    const terminal = await gateway.dispatchGatewayTool("execute_command", {
      command: `printf denied > ${terminalTarget}`,
      cwd: dataDir,
    }, {
      auditCall: false,
      context: { runtimeMode: "auto-accept-edits", chatId: "chat-test", jobId: "job-test" },
    });
    assert.equal(terminal.isError, true);
    assert.equal(existsSync(terminalTarget), false);
    assert.equal(requests, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
