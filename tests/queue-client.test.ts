import assert from "node:assert/strict";
import test from "node:test";
import { mergeQueuedFollowUps } from "../lib/composer-send";
import { removeQueuedFollowUp } from "../lib/queue-client";

test("clicking remove suppresses live-sync echoes before DELETE completes", async () => {
  const message = { id: "q-remove", text: "delete", files: ["attachment"] };
  const kept = { id: "q-keep", text: "keep", files: [] };
  let queue = [message, kept];
  const removedIds = new Set<string>();
  let finish!: (response: Response) => void;
  const deleting = removeQueuedFollowUp({
    chatId: "chat", messageId: message.id, removedIds,
    removeLocally: () => { queue = queue.filter((item) => item.id !== message.id); },
    restoreLocally: () => { queue.unshift(message); },
    request: async (url, init) => {
      assert.equal(url, "/api/chats/chat/queue/q-remove");
      assert.equal(init?.method, "DELETE");
      return new Promise<Response>((resolve) => { finish = resolve; });
    },
  });
  assert.deepEqual(queue, [kept]);
  queue = mergeQueuedFollowUps(queue, [message, kept], { removedIds });
  assert.deepEqual(queue, [kept]);
  finish(Response.json({ ok: true }));
  assert.equal(await deleting, true);
  assert.ok(removedIds.has(message.id));
});

test("failed deletes restore the item and allow another attempt", async () => {
  for (const failure of ["http", "network"]) {
    const removedIds = new Set<string>();
    let visible = true;
    await assert.rejects(removeQueuedFollowUp({
      chatId: "chat", messageId: "q", removedIds,
      removeLocally: () => { visible = false; },
      restoreLocally: () => { visible = true; },
      request: async () => {
        if (failure === "network") throw new Error("offline");
        return new Response(null, { status: 500 });
      },
    }));
    assert.equal(visible, true);
    assert.equal(removedIds.has("q"), false);
  }
});

test("deleting one item twice cannot issue competing requests", async () => {
  const removedIds = new Set<string>();
  let calls = 0;
  const options = {
    chatId: "chat", messageId: "q", removedIds,
    removeLocally: () => {}, restoreLocally: () => {},
    request: async () => { calls++; return Response.json({ ok: true }); },
  };
  await Promise.all([removeQueuedFollowUp(options), removeQueuedFollowUp(options)]);
  assert.equal(calls, 1);
});

test("draft removal stays local and persisted IDs are safely encoded", async () => {
  let calls = 0;
  const base = {
    messageId: "q/a?", removedIds: new Set<string>(),
    removeLocally: () => {}, restoreLocally: () => {},
    request: async (url: Parameters<typeof fetch>[0]) => {
      calls++;
      assert.equal(url, "/api/chats/chat%2Fid/queue/q%2Fa%3F");
      return Response.json({ ok: true });
    },
  };
  assert.equal(await removeQueuedFollowUp({ ...base, chatId: null }), true);
  assert.equal(calls, 0);
  assert.equal(await removeQueuedFollowUp({ ...base, removedIds: new Set(), chatId: "chat/id" }), true);
  assert.equal(calls, 1);
});
