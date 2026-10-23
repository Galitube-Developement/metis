import assert from "node:assert/strict";
import test, {before} from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createRequire} from "node:module";
import type {ToolCallData} from "../components/tool-call-chip";
Object.assign(globalThis,{React});
const require=createRequire(import.meta.url);
require.extensions[".css"]=()=>{};
let Group: typeof import("../components/tool-call-chip").ToolCallGroup;
let Preview: typeof import("../components/tool-call-preview").ToolCallPreview;
before(async()=>{
  ({ToolCallGroup:Group}=await import("../components/tool-call-chip"));
  ({ToolCallPreview:Preview}=await import("../components/tool-call-preview"));
});
const kinds: NonNullable<ToolCallData["kind"]>[] = ["read","edit","shell","todo","plan","canvas","memory","automation","note","browser","subagent","mcp","compaction","other"];

test("every tool kind uses one shared collapsible group and compact row in input order",()=>{
  const tools=kinds.map((kind,index)=>({id:String(index),name:kind+" operation",kind,status:"completed"}));
  const html=renderToStaticMarkup(<Group tools={tools}/>);
  assert.equal((html.match(/data-tool-call-group=/g)||[]).length,1);
  assert.equal((html.match(/data-tool-call-row=/g)||[]).length,kinds.length);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/hidden=""/);
  const rendered=[...html.matchAll(/data-tool-kind="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(rendered,kinds);
  assert.doesNotMatch(html,/Task checklist|Memory details|Build with/);
});

test("a single wrapped write_todos call follows the same collapsed path",()=>{
  const html=renderToStaticMarkup(<Group tools={[{id:"task",name:"call_mcp_tool",status:"completed",input:JSON.stringify({toolName:"write_todos",arguments:{todos:[{content:"Check layout",status:"pending"}]}})}]}/>);
  assert.match(html,/data-tool-kind="todo"/);
  assert.match(html,/Updated tasks/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/0\/1 completed/);
  assert.doesNotMatch(html,/Task checklist/);
});

test("task preview preserves full content, completion and an empty checklist",()=>{
  const html=renderToStaticMarkup(<Preview tool={{name:"write_todos",kind:"todo",status:"completed",todos:[{id:"one",content:"Completed task",status:"completed"},{id:"two",content:"Still working",status:"in_progress"}]}}/>);
  assert.match(html,/Task checklist/);
  assert.match(html,/1\/2/);
  assert.match(html,/Completed task/);
  assert.match(html,/Still working/);
  assert.match(html,/in_progress/);
  const empty=renderToStaticMarkup(<Preview tool={{name:"write_todos",kind:"todo",status:"completed",todos:[]}}/>);
  assert.match(empty,/No tasks/);
});

test("failed calls remain visible and failed workspace results offer no success preview",()=>{
  const html=renderToStaticMarkup(<Group tools={[{id:"failed",name:"create_plan",kind:"plan",status:"failed",input:JSON.stringify({content:"Draft"})}]}/>);
  assert.match(html,/Failed/);
  assert.match(html,/data-tool-kind="plan"/);
  const failed=renderToStaticMarkup(<Preview tool={{name:"create_plan",kind:"plan",status:"completed",input:JSON.stringify({content:"Draft"}),result:JSON.stringify({isError:true,error:"Conflict"})}}/>);
  assert.equal(failed,"");
});

test("canvas and memory details preserve readable stored content",()=>{
  const canvas=renderToStaticMarkup(<Preview tool={{name:"edit_canvas",kind:"canvas",status:"completed",result:JSON.stringify({workspaceLink:"workspace://canvas/canvas-one"})}} workspaces={[{id:"canvas-one",type:"canvas",name:"Canvas title",content:"Preserved canvas body"}]}/>);
  assert.match(canvas,/Canvas title/);
  assert.match(canvas,/Preserved canvas body/);
  const memory=renderToStaticMarkup(<Preview tool={{name:"add_memory",kind:"memory",status:"completed",result:JSON.stringify({scope:"chat",memory:{content:"Stored fact"}})}}/>);
  assert.match(memory,/Saved Chat Memory/);
  assert.match(memory,/Stored fact/);
});
