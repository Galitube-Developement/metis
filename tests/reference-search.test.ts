import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceLookup, referenceMatches } from "../lib/reference-search";

test("reference search matches words independently, accents, Unicode and German spelling", () => {
  assert.equal(referenceMatches("marz strasse", "Straße", "MÄRZ"), true);
  assert.equal(referenceMatches("LAUNCH checklist", "Launch notes", "checklist"), true);
  assert.equal(referenceMatches("missing", "Launch notes"), false);
  assert.equal(referenceMatches("   ", "Any"), true);
});

test("late and aborted lookups cannot replace a newer category or repopulate a closed menu", async () => {
  const pending: Array<{resolve: (r: Response) => void; url: string}> = [];
  const lookup = createReferenceLookup<string>(((url: string) => new Promise<Response>(resolve => pending.push({resolve, url}))) as typeof fetch);
  const states: Array<{key: string; status: string; results: string[]}> = [];
  const first = lookup.load({ key: "old", kind: "note", query: "old", chatId: "current" }, state => states.push(state));
  const next = lookup.load({ key: "new", kind: "canvas", query: "architecture", chatId: "current" }, state => states.push(state));
  assert.match(pending[1].url, /kind=canvas/);
  pending[1].resolve(Response.json({ results: ["Correct canvas"] })); await next;
  pending[0].resolve(Response.json({ results: ["Stale note"] })); await first;
  assert.deepEqual(states.at(-1)?.results, ["Correct canvas"]);
  assert.ok(!states.some(s => s.results.includes("Stale note")));
  const closed = lookup.load({ key: "closed", kind: "chat", query: "" }, state => states.push(state));
  lookup.cancel();
  pending[2].resolve(Response.json({ results: ["After close"] })); await closed;
  assert.ok(!states.some(s => s.results.includes("After close")));
});

test("lookup exposes errors and a fresh retry replaces them with real results", async () => {
  let attempts = 0;
  const lookup = createReferenceLookup<string>((async () => ++attempts === 1
    ? Response.json({ error: "Internal error" }, { status: 500 })
    : Response.json({ results: ["Recovered"] })) as typeof fetch);
  const states: Array<{status: string; results: string[]; error?: string}> = [];
  const input = { key: "request", query: "", kind: "note" as const };
  await lookup.load(input, state => states.push(state));
  assert.equal(states.at(-1)?.status, "error");
  assert.match(states.at(-1)?.error || "", /Try again/);
  await lookup.load(input, state => states.push(state));
  assert.deepEqual(states.at(-1)?.results, ["Recovered"]);
});
