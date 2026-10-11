import assert from "node:assert/strict";
import test from "node:test";
import { payloadRecord, payloadText } from "../lib/agent-payload";
import { formatThinkingDuration } from "../lib/activity-display";
import { normalizeContextText } from "../lib/text-normalization";
import { subscribeToWindowEvents } from "../lib/browser-events";
import { gatewayResultJson } from "../lib/gateway-request";

test("provider payloads preserve nested block order, strings and scalar text", () => {
  const blocks = [
    { text: "first" },
    { content: [{ text: "second" }, { message: "third" }] },
    JSON.stringify({ message: "fourth" }),
    { text: 0 }, { text: false }, {}, null,
  ];
  assert.equal(payloadText(blocks), "first\nsecond\nthird\nfourth\n0\nfalse");
  assert.equal(payloadText({ text: "", content: "fallback" }), "");
  assert.equal(payloadText('{"text":"literal"}'), '{"text":"literal"}');
  assert.equal(payloadText(null), "");
});

test("worker and transcript JSON nesting limits stay distinct", () => {
  const object = { text: "nested" };
  const once = JSON.stringify(object);
  const twice = JSON.stringify(once);
  const threeTimes = JSON.stringify(twice);
  assert.deepEqual(payloadRecord(once), object);
  assert.deepEqual(payloadRecord(twice), {});
  assert.deepEqual(payloadRecord(threeTimes, 3), object);
  assert.deepEqual(payloadRecord(JSON.stringify(threeTimes), 3), {});
  assert.equal(payloadText([twice]), "");
  assert.equal(payloadText([twice], 3), "nested");
  for (const value of ["invalid", "[]", "null", "1", "", [], null]) {
    assert.deepEqual(payloadRecord(value), {});
  }
});

test("both thought displays keep duration boundaries and invalid values", () => {
  for (const value of [undefined, 0, -1, NaN, Infinity]) assert.equal(formatThinkingDuration(value), null);
  for (const [value, label] of [[999, "999ms"], [1000, "1s"], [1250, "1.3s"], [9900, "9.9s"], [10001, "10s"]] as const) {
    assert.equal(formatThinkingDuration(value), label);
  }
});

test("retrieval normalization preserves path tokens and existing Unicode behavior", () => {
  assert.equal(normalizeContextText("  METIS /Lib/Foo.ts — １２３!  "), "metis /lib/foo.ts 123");
  assert.equal(normalizeContextText("Café"), normalizeContextText("Cafe\u0301"));
  assert.equal(normalizeContextText("Ä"), "a");
});

test("browser subscriptions deliver each event and detach all listeners", () => {
  const target = new EventTarget();
  let calls = 0;
  const callback = () => { calls++; };
  const detach = subscribeToWindowEvents(["storage", "preference", "keydown"], callback, target);
  for (const name of ["storage", "preference", "keydown"]) target.dispatchEvent(new Event(name));
  assert.equal(calls, 3);
  detach();
  for (const name of ["storage", "preference", "keydown"]) target.dispatchEvent(new Event(name));
  assert.equal(calls, 3);
  const again = subscribeToWindowEvents(["storage"], callback, target);
  target.dispatchEvent(new Event("storage"));
  assert.equal(calls, 4);
  again();
});

test("gateway response decoding preserves errors and rejects malformed JSON", () => {
  assert.deepEqual(gatewayResultJson({ content: [{ text: '{"servers":' }, { text: "[]}" }] }), { servers: [] });
  assert.throws(() => gatewayResultJson({ isError: true, content: [{ text: "credentials missing" }] }), /credentials missing/);
  assert.throws(() => gatewayResultJson({ isError: true }), /MCP operation failed/);
  assert.throws(() => gatewayResultJson({ content: [{ text: "bad JSON" }] }), /invalid JSON/);
  assert.throws(() => gatewayResultJson({}), /invalid JSON/);
});
