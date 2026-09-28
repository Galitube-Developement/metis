import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_SLASH_COMMANDS, goalCommandAction, matchSlashCommand, slashCommandQuery } from "../lib/slash-commands";

test("built-in slash commands are discoverable at the composer start", () => {
  assert.deepEqual(BUILT_IN_SLASH_COMMANDS.map((command) => command.id), ["model", "goal"]);
  assert.equal(slashCommandQuery("/mo", 3), "mo");
  assert.equal(slashCommandQuery("/goal ", 6), null);
  assert.equal(slashCommandQuery("hello /model", 12), null);
});

test("slash command parser keeps goal arguments and rejects unknown commands", () => {
  assert.deepEqual(matchSlashCommand("/model"), { id: "model", argument: "" });
  assert.deepEqual(matchSlashCommand("/goal Ship the feature"), { id: "goal", argument: "Ship the feature" });
  assert.deepEqual(matchSlashCommand("/goal line one\nline two"), { id: "goal", argument: "line one\nline two" });
  assert.equal(matchSlashCommand("/unknown text"), null);
  assert.equal(matchSlashCommand("Send /model"), null);
});

test("goal text sends normally while bare goal and reset clear it", () => {
  assert.deepEqual(goalCommandAction("Ship the feature"), { kind: "set", goal: "Ship the feature" });
  assert.deepEqual(goalCommandAction(""), { kind: "reset" });
  assert.deepEqual(goalCommandAction("reset"), { kind: "reset" });
  assert.deepEqual(goalCommandAction("RESET"), { kind: "reset" });
  assert.deepEqual(goalCommandAction("clear"), { kind: "reset" });
  assert.deepEqual(goalCommandAction("reset the layout"), { kind: "set", goal: "reset the layout" });
});
