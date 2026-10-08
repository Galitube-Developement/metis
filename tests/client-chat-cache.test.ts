import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MEMORY_CHAT_SNAPSHOTS,
  readClientChatSnapshot,
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

test("upgrading the browser cache discards old raw-payload copies before navigation", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const rows = new Map([["scope::chat", { key: "scope::chat", cachedAt: Date.now(), value: { messages: ["old raw output"] } }]]);
  let requestedVersion = 0;
  let closed = false;
  const store = {
    clear() { rows.clear(); },
    get(key: string) {
      const request = { result: rows.get(key), onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
    close() { closed = true; },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    indexedDB: {
      open(_name: string, version: number) {
        requestedVersion = version;
        const request = {
          result: db, transaction: { objectStore: () => store },
          onupgradeneeded: undefined as ((event: { oldVersion: number }) => void) | undefined,
          onsuccess: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => { request.onupgradeneeded?.({ oldVersion: 1 }); request.onsuccess?.(); });
        return request;
      },
    },
  } });
  try {
    assert.equal(await readClientChatSnapshot("scope", "chat"), null);
    assert.ok(requestedVersion > 1);
    assert.equal(rows.size, 0);
    assert.equal(closed, true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
