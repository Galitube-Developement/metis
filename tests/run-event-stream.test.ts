import assert from "node:assert/strict";
import test from "node:test";
import { createRunEventStream, RUN_STREAM_BATCH_SIZE } from "../lib/run-event-stream";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);

test("slow reader pulls bounded batches and cancellation stops idle polling", async () => {
  let reads = 0;
  const stream = createRunEventStream({
    after: 0, pollMs: 5,
    read: (after, limit) => {
      reads++;
      assert.equal(limit, RUN_STREAM_BATCH_SIZE);
      return Array.from({ length: limit }, (_, i) => ({ id: after+i+1, event: "text", data: { text: "x".repeat(128_000) } }));
    },
    terminal: () => null,
  });
  const reader = stream.getReader();
  await pause(15);
  assert.equal(reads, 0);
  await reader.read();
  await pause(15);
  assert.equal(reads, 1);
  await reader.cancel();
  await pause(15);
  assert.equal(reads, 1);

  const idle = createRunEventStream({ after: 0, pollMs: 5, read: () => { reads++; return []; }, terminal: () => null }).getReader();
  const pending = idle.read();
  await pause(15);
  await idle.cancel();
  assert.equal((await pending).done, true);
  const atCancel = reads;
  await pause(20);
  assert.equal(reads, atCancel);
});

test("all replay events precede terminal fallback, including backlogs larger than 500", async () => {
  const events = Array.from({length: 1_201}, (_, i) => ({ id: i+1, event: "text", data: {text: String(i)} }));
  let reads = 0, terminalChecks = 0;
  const stream = createRunEventStream({
    after: 0,
    read: (after, limit) => { reads++; return events.filter(event => event.id > after).slice(0,limit); },
    terminal: () => { terminalChecks++; return {event:"done",data:{status:"completed"}}; },
  });
  const reader = stream.getReader();
  const chunks: string[] = [];
  for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(decode(next.value)); }
  assert.equal(chunks.length, 1_202);
  assert.equal(terminalChecks, 1);
  assert.equal(reads, Math.ceil(1201/RUN_STREAM_BATCH_SIZE)+2);
  for (let i=0;i<1201;i++) assert.match(chunks[i], new RegExp("^id: "+(i+1)+"\\n"));
  assert.match(chunks.at(-1)!, /event: done/);
});

test("snapshot opt-in, resume cursor and error text retain their semantics", async () => {
  const events = [
    {id:1,event:"text",data:{text:"previous"}},
    {id:2,event:"thinking",data:{text:"hidden"}},
    {id:3,event:"tool",data:{result:"COMPLETE_TOOL_RESULT"}},
    {id:4,event:"error",data:{message:"Specific provider failure"}},
  ];
  const stream = createRunEventStream({
    after: 1, snapshotOnly: true,
    read: after => events.filter(event => event.id > after),
    terminal: () => { throw new Error("Explicit terminal event should close stream"); },
  });
  const text = await new Response(stream).text();
  assert.doesNotMatch(text, /previous|hidden/);
  assert.match(text, /id: 3/);
  assert.match(text, /COMPLETE_TOOL_RESULT/);
  assert.match(text, /Specific provider failure/);
});

test("abort wakes an outstanding read; heartbeat and connection expiry remain transport events", async () => {
  const abort = new AbortController();
  let reads = 0;
  const reader = createRunEventStream({after:0,signal:abort.signal,pollMs:60_000,read:()=>{reads++;return [];},terminal:()=>null}).getReader();
  const pending = reader.read();
  await pause(5);
  abort.abort();
  assert.equal((await pending).done,true);
  assert.equal(reads,1);
  const heartbeat = createRunEventStream({after:0,heartbeatMs:0,read:()=>[],terminal:()=>null}).getReader();
  assert.equal(decode((await heartbeat.read()).value), ": heartbeat\n\n");
  await heartbeat.cancel();
  const expired = await new Response(createRunEventStream({after:0,windowMs:0,read:()=>{throw new Error("expired");},terminal:()=>null})).text();
  assert.match(expired,/reconnect/);
  assert.doesNotMatch(expired,/event: error/);
});

test("database errors propagate and release the polling lifecycle", async () => {
  const reader = createRunEventStream({after:0,read:()=>{throw new Error("database unavailable");},terminal:()=>null}).getReader();
  await assert.rejects(reader.read(), /database unavailable/);
});

test("events committed concurrently with terminal status are drained before fallback", async () => {
  let committed = false;
  const stream = createRunEventStream({
    after: 0,
    read: after => committed && after < 1 ? [{ id: 1, event: "text", data: { text: "last delta" } }] : [],
    terminal: () => { committed = true; return { event: "done", data: { status: "completed" } }; },
  });
  const text = await new Response(stream).text();
  assert.ok(text.indexOf("last delta") >= 0);
  assert.ok(text.indexOf("last delta") < text.indexOf("event: done"));
});
