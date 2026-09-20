import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MEMORY_CHAT_SNAPSHOTS,
  MAX_SNAPSHOTS,
  pruneMemoryChatCache,
  shouldPersistClientChatSnapshot,
} from "../lib/client-chat-cache";

test("in-memory chat snapshots stay capped and keep the active chat", () => {
  const cache = new Map<string, number>();
  for (let index = 0; index < 20; index += 1) cache.set(`chat-${index}`, index);
  pruneMemoryChatCache(cache, ["chat-19", "chat-18", "chat-17"]);
  assert.ok(cache.size <= MAX_MEMORY_CHAT_SNAPSHOTS);
  assert.equal(cache.size, MAX_MEMORY_CHAT_SNAPSHOTS);
  assert.equal(cache.has("chat-19"), true);
  assert.equal(cache.has("chat-0"), false);
});

test("disk snapshots stay smaller than the previous unbounded 24-chat cache", () => {
  assert.equal(MAX_SNAPSHOTS, 8);
  assert.ok(MAX_SNAPSHOTS <= MAX_MEMORY_CHAT_SNAPSHOTS);
});

test("streaming runs do not persist client chat snapshots", () => {
  assert.equal(shouldPersistClientChatSnapshot({ busy: true }), false);
  assert.equal(shouldPersistClientChatSnapshot({ busy: false, incognito: true }), false);
  assert.equal(shouldPersistClientChatSnapshot({ busy: false, incognito: false }), true);
});
