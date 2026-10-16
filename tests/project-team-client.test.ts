import assert from "node:assert/strict";
import test from "node:test";
import { fetchProjectTeam, mergeProjectChatAgents } from "../lib/project-team-client";
import type { ProjectAgent } from "../lib/project-team-types";
const agent: ProjectAgent = { id: "a", projectId: "team", chatId: "chat", name: "Coordinator", role: "Reviews", systemPrompt: "", color: "#14b8a6", status: "idle", createdAt: "", updatedAt: "" };
const success = () => Response.json({ agents: [agent], handoffs: [] });
test("empty and truncated JSON recover through bounded read retries", async t => {
 for (const invalid of ["", '{"agents":']) {
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>++calls===1?new Response(invalid,{status:200}):success());
  assert.deepEqual(await fetchProjectTeam("team"),{agents:[agent],handoffs:[]});
  assert.equal(calls,2); t.mock.restoreAll();
 }
});
test("5xx HTML and transport failures recover, while malformed success stops at three attempts", async t => {
 for (const failure of ["html","network","stream"]) {
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{
   if(++calls>1)return success();
   if(failure==="network")throw new TypeError("Failed to fetch");
   if(failure==="stream")return new Response(new ReadableStream({start(c){c.error(new Error("Stream interrupted"));}}));
   return new Response("<html>Unavailable</html>",{status:503});
  });
  await fetchProjectTeam("team");assert.equal(calls,2);t.mock.restoreAll();
 }
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response("");});
 await assert.rejects(fetchProjectTeam("team"),/incomplete response/);assert.equal(calls,3);
});
test("authorization and not found responses remain semantic errors, even without JSON", async t => {
 for(const [status,expected] of [[401,/Sign in again/],[403,/access/],[404,/could not be found/]] as const){
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return new Response("",{status});});
  await assert.rejects(fetchProjectTeam("team"),expected);assert.equal(calls,1);t.mock.restoreAll();
 }
});
test("invalid or foreign team payloads are rejected without presenting an empty or different team", async t => {
 for(const body of [{}, {agents:[],handoffs:{}}, {agents:[null],handoffs:[]},{agents:[{...agent,projectId:"foreign"}],handoffs:[]}]){
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(body);});
  await assert.rejects(fetchProjectTeam("team"),/incomplete response/);assert.equal(calls,3);t.mock.restoreAll();
 }
});
test("abort during retry cancels the wait and stops additional requests", async t => {
 let calls=0;const controller=new AbortController();
 t.mock.method(globalThis,"fetch",async()=>{calls++;setTimeout(()=>controller.abort(),5);return new Response("",{status:503});});
 await assert.rejects(fetchProjectTeam("team",controller.signal),{name:"AbortError"});assert.equal(calls,1);
});
test("abort while reading malformed JSON keeps cancellation distinct from a parser error",async t=>{
 const controller=new AbortController();let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;queueMicrotask(()=>controller.abort());return new Response("");});
 await assert.rejects(fetchProjectTeam("team",controller.signal),{name:"AbortError"});assert.equal(calls,1);
});
test("failed identity refreshes preserve only currently requested projects; valid emptiness removes old identities",()=>{
 const second={...agent,id:"b",projectId:"other",chatId:"other-chat"};
 const previous={chat:agent,"other-chat":second};
 assert.deepEqual(mergeProjectChatAgents(previous,["team"],[{projectId:"team"}]),{chat:agent});
 assert.deepEqual(mergeProjectChatAgents(previous,["team"],[{projectId:"team",agents:[]}]),{});
 assert.deepEqual(mergeProjectChatAgents(previous,["team","other"],[{projectId:"team"},{projectId:"other",agents:[{...second,name:"Updated"}]}]),
  {chat:agent,"other-chat":{...second,name:"Updated"}});
});
