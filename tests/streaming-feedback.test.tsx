import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolInputStatus } from "../components/tool-input-status";
import { AgentActivity } from "../components/agent-activity";
import { runtimeEventFromRunEvent } from "../lib/runtime/from-run-event";
import { compactChatPageMessages } from "../lib/chat-page-payload";
import type { ChatMessage } from "../lib/store";
Object.assign(globalThis,{React});

test("preparation shows a truthful label and exact characters, including zero",()=>{
 const html=renderToStaticMarkup(<ToolInputStatus name="execute_command" kind="shell" characters={1204}/>);
 assert.match(html,/Preparing command/);assert.match(html,/class="sr-only">1,204/);
 assert.match(html,/chars/);assert.match(html,/data-run-status="running"/);
 const unknown=renderToStaticMarkup(<ToolInputStatus name="tool" />);
 assert.doesNotMatch(unknown,/chars/);
 assert.match(renderToStaticMarkup(<ToolInputStatus name="read_file" kind="read" characters={0}/>),/class="sr-only">0/);
});

test("buffered-provider activity stays visible without a fabricated character count",()=>{
 const html=renderToStaticMarkup(<AgentActivity activityKey="run-1"/>);
 assert.match(html,/Preparing next action/);assert.match(html,/data-run-status="running"/);
 assert.doesNotMatch(html,/chars/);
});

test("preparation telemetry survives runtime conversion and compact page payloads",()=>{
 const event=runtimeEventFromRunEvent({id:1,chatId:"chat-a",jobId:"run-a",createdAt:"2026-10-11T00:00:00Z",event:"tool",
  data:{callId:"call-a",name:"write_file",kind:"edit",status:"running",phase:"preparing",inputChars:3256,source:"mcp"}});
 assert.ok(event?.type==="item.tool.started");assert.equal(event.itemId,"call-a");
 assert.equal(event.chatId,"chat-a");assert.equal(event.payload.phase,"preparing");assert.equal(event.payload.inputChars,3256);assert.equal(event.payload.source,"mcp");
 const message:ChatMessage={id:"message",role:"assistant",content:"",createdAt:"2026-10-11T00:00:00Z",tools:[{id:"call-a",name:"write_file",status:"running",phase:"preparing",inputChars:3256}]};
 const compact=compactChatPageMessages([message],"chat-a");
 assert.equal(compact[0].tools?.[0].inputChars,3256);assert.equal(compact[0].tools?.[0].phase,"preparing");
 assert.equal(compact[0].tools?.[0].input,undefined);
});


test("activity uses genuine tool metadata over a generic or stale status label",()=>{
 const html=renderToStaticMarkup(<AgentActivity activityKey="run-1" label="Preparing next action" tool={{id:"call-a",name:"write_file",kind:"edit",source:"mcp",phase:"preparing",inputChars:3256}}/>);
 assert.match(html,/Preparing file edit · MCP · write_file/);
 assert.match(html,/class="sr-only">3,256/);assert.match(html,/chars/);
 assert.doesNotMatch(html,/Preparing next action/);
 const unknown=renderToStaticMarkup(<AgentActivity activityKey="run-1" tool={{name:"read_file",kind:"read",source:"mcp"}}/>);
 assert.match(unknown,/Preparing file read · MCP · read_file/);assert.doesNotMatch(unknown,/chars/);
 const invalid=renderToStaticMarkup(<ToolInputStatus name="read_file" source="mcp" characters={NaN}/>);
 assert.doesNotMatch(invalid,/chars/);assert.doesNotMatch(invalid,/NaN/);
});
