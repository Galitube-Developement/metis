import assert from "node:assert/strict";
import test from "node:test";
import { fetchProjectHome } from "../lib/project-home-client";
const payload = { project: { id: "project", name: "Review", icon: "folder", color: "#14b8a6", instructions: "", memoryMode: "default", memories: [], disabledSkillIds: [] }, files: [], notes: [], chats: [], skills: [] };
test("project hub recovers empty, truncated, HTML, disconnected and 5xx responses", async t => {
  for (const failure of ["", '{"project":', "<html>", "network", "stream", "503"]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      if (++calls > 1) return Response.json(payload);
      if (failure === "network") throw new TypeError("Failed to fetch");
      if (failure === "stream") return new Response(new ReadableStream({ start(c) { c.error(new Error("Disconnected")); } }));
      return new Response(failure, { status: failure === "503" ? 503 : 200 });
    });
    assert.deepEqual(await fetchProjectHome("project"), payload);
    assert.equal(calls, 2); t.mock.restoreAll();
  }
});
test("project hub rejects incomplete and foreign payloads after three reads without parser internals", async t => {
  for (const bad of [{}, { ...payload, project: { ...payload.project, id: "other" } }, { ...payload, files: [null] }, { ...payload, skills: [{ id: "skill", name: "wrong" }] }]) {
    let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(bad); });
    await assert.rejects(fetchProjectHome("project"), /incomplete response/);
    assert.equal(calls, 3); t.mock.restoreAll();
  }
});
test("permissions and cancellation never retry or turn into parse errors", async t => {
  for (const status of [401, 403, 404]) {
    let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("", { status }); });
    await assert.rejects(fetchProjectHome("project"), /session|access|could not be found/);
    assert.equal(calls, 1); t.mock.restoreAll();
  }
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; queueMicrotask(() => controller.abort()); return new Response(""); });
  await assert.rejects(fetchProjectHome("project", controller.signal), { name: "AbortError" }); assert.equal(calls, 1);
});
test("valid populated project data retains file, memory, chat, note and skill records", async t => {
  const body = { ...payload, project: { ...payload.project, memories: [{ id: "m", content: "Memory" }] }, files: [{ id: "f", name: "photo.png", mimeType: "image/png", size: 12 }], chats: [{ id: "c", title: "Chat" }], notes: [{ id: "n", title: "Note" }], skills: [{ id: "s", title: "Skill" }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(body));
  assert.deepEqual(await fetchProjectHome("project"), body);
});
