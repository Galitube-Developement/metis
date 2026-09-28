import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Chat } from "../lib/store";
import { recoveryTranscript } from "../lib/providers/recovery-transcript";
import { nativeRecoveryPrompt, type ProviderContext } from "../lib/providers/adapters/provider-support";
import { nativeSessionNeedsManagedCompaction } from "../lib/providers/session-bindings";

const msg = (id: string, role: "user" | "assistant", content: string, tools?: Chat["messages"][number]["tools"]) =>
  ({ id, role, content, createdAt: "2026-09-28T00:00:00Z", ...(tools ? { tools } : {}) });

test("recovery keeps the original task and latest correction when tool output is huge", () => {
  const chat = { messages: [
    msg("first", "user", "ORIGINAL_TASK: repair the report and preserve custom edits"),
    msg("tools", "assistant", "The report is being edited.", [
      { id: "read", name: "read_file", kind: "read", status: "completed", path: "/repo/report.ts", result: "RAW_READ_OUTPUT ".repeat(50_000) },
      { id: "edit", name: "edit_file", kind: "edit", status: "completed", input: JSON.stringify({ path: "/repo/report.ts" }), result: JSON.stringify({ stdout: "WROTE:/repo/report.ts" }) },
      { id: "todo", name: "Tasks", kind: "todo", status: "completed", todos: [{ content: "Verify report output", status: "in_progress" }] },
    ]),
    msg("correction", "user", "LATEST_CORRECTION: keep the existing heading"),
    msg("live", "user", "LIVE_TURN_EXCLUDED"),
  ] } as Chat;

  const result = recoveryTranscript(chat, "live", 2_500);
  assert.ok(result.length <= 2_500);
  assert.match(result, /ORIGINAL_TASK/);
  assert.match(result, /LATEST_CORRECTION/);
  assert.match(result, /\/repo\/report.ts/);
  assert.match(result, /Verify report output/);
  assert.doesNotMatch(result, /RAW_READ_OUTPUT|LIVE_TURN_EXCLUDED/);
});

test("recovery reserves space for the first request and recent user decisions", () => {
  const messages: Chat["messages"] = [msg("first", "user", "FIRST_REQUIREMENT preserve the export format")];
  for (let index = 0; index < 50; index += 1) {
    messages.push(msg(`a${index}`, "assistant", `assistant progress ${index} ` + "x".repeat(500)));
  }
  messages.push(msg("last", "user", "LATEST_DECISION use the existing output path"));
  messages.push(msg("answer", "assistant", "The next action is to verify the export."));

  const result = recoveryTranscript({ messages }, undefined, 3_000);
  assert.ok(result.length <= 3_000);
  assert.match(result, /FIRST_REQUIREMENT/);
  assert.match(result, /LATEST_DECISION/);
  assert.match(result, /next action is to verify/);
  assert.match(result, /older messages omitted/);
});

test("native provider pressure does not discard Codex or Cursor session state", () => {
  const worker = readFileSync(new URL("../lib/worker-runner.ts", import.meta.url), "utf8");
  assert.equal(nativeSessionNeedsManagedCompaction("codex-sdk", { lastContextTokens: 8_000 }, 10_000), false);
  assert.equal(nativeSessionNeedsManagedCompaction("claude-agent", { lastContextTokens: 8_000 }, 10_000), true);
  assert.match(worker, /const shouldResumeNative = hasPriorNativeAgentId\s+&& !nativeContextWindowChanged/);
  assert.doesNotMatch(worker, /&& !nativeContextPressure/);
});


test("native recovery prompt keeps the task when persisted tool output dominates", () => {
  const chat = { id: "recovery-chat", messages: [
    msg("first", "user", "ORIGINAL_TASK: ship the carefully reviewed fix"),
    msg("tools", "assistant", "Progress made.", [
      { id: "shell", name: "execute_command", kind: "shell", status: "completed", result: "build log ".repeat(100_000) },
    ]),
    msg("correction", "user", "LATEST_CORRECTION: preserve the current deployment slot"),
    msg("live", "user", "LIVE_TURN_EXCLUDED"),
  ] } as Chat;
  const context = {
    chat,
    job: { id: "job", chatId: chat.id, messageId: "live", message: "Continue.", modelId: "openai:test:gpt-5" },
    connection: { id: "test", providerKey: "openai", label: "Test", enabled: true, authType: "api_key", secret: "test", config: {} },
    modelId: "gpt-5",
    onCompaction: () => undefined,
  } as unknown as ProviderContext;
  const prompt = nativeRecoveryPrompt(context, 3_000);
  assert.match(prompt, /ORIGINAL_TASK/);
  assert.match(prompt, /LATEST_CORRECTION/);
  assert.doesNotMatch(prompt, /LIVE_TURN_EXCLUDED|build log build log build log/);
});


test("native recovery checkpoint contains history only, never persisted system text", () => {
  const chat = { messages: [
    { id: "system", role: "system", content: "SYSTEM_PROMPT_MUST_STAY_OUTSIDE_RECAP", createdAt: "t" },
    msg("user", "user", "Continue the task."),
  ] } as Chat;
  const recap = recoveryTranscript(chat);
  assert.match(recap, /Continue the task/);
  assert.doesNotMatch(recap, /SYSTEM_PROMPT_MUST_STAY_OUTSIDE_RECAP/);
});
