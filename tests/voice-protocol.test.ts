import assert from "node:assert/strict";
import test from "node:test";
import { applyVoiceTurnEvent, parseVoiceChannelEvent, recentVoiceContext, validateVoiceTurnEvent } from "../lib/voice-protocol";

test("observed AVAS V3 turn events produce a complete transcript without repeating fragments", () => {
  const created = parseVoiceChannelEvent({ type: "turn.created", turn: { id: "turn_test", role: "user", transcript: " Hello" } })!;
  const delta = parseVoiceChannelEvent({ type: "turn.delta", turn_id: "turn_test", delta: " Metis" })!;
  let turn = applyVoiceTurnEvent(undefined, created);
  turn = applyVoiceTurnEvent(turn, delta);
  assert.equal(turn?.text, " Hello Metis");
  const done = parseVoiceChannelEvent({ type: "turn.done", turn: { id: "turn_test", role: "user", transcript: " Hello Metis." } })!;
  turn = applyVoiceTurnEvent(turn, done);
  assert.equal(turn?.text, " Hello Metis.");
  assert.equal(turn?.complete, true);
  assert.equal(applyVoiceTurnEvent(turn, delta)?.text, " Hello Metis.");
  assert.equal(parseVoiceChannelEvent({ type: "session.started", session: { id: "call" } }), undefined);
  assert.equal(parseVoiceChannelEvent({ type: "item/tool/call", arguments: { command: "anything" } }), undefined);
});

test("relay validation cannot introduce system roles, arbitrary methods or oversized text", () => {
  assert.throws(() => validateVoiceTurnEvent({ type: "done", id: "turn", role: "system", text: "bad" }));
  assert.throws(() => validateVoiceTurnEvent({ type: "turn/start", id: "turn", text: "bad" }));
  assert.throws(() => validateVoiceTurnEvent({ type: "done", id: "../../file", role: "user", text: "bad" }));
  assert.throws(() => validateVoiceTurnEvent({ type: "done", id: "turn", role: "user", text: "x".repeat(32_001) }));
});

test("text continuation receives the recent voice exchange once without replaying old voice history", () => {
  const messages = [
    { id: "old-text", role: "user", content: "Old task" },
    { id: "voice:session:user", role: "user", content: "Remember the word pineapple" },
    { id: "voice:session:assistant", role: "assistant", content: "Pineapple" },
    { id: "new-user", role: "user", content: "What word did I say?" },
    { id: "new-assistant", role: "assistant", content: "" },
  ];
  assert.match(recentVoiceContext(messages, "new-user"), /user: Remember the word pineapple\nassistant: Pineapple/);
  assert.doesNotMatch(recentVoiceContext(messages, "new-user"), /Old task|What word/);
  assert.equal(recentVoiceContext(messages), "");
});
