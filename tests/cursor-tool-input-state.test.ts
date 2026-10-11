import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {canonicalizeToolPart} from "../lib/providers/tool-events";
import {classifyToolKind,innerToolName,todosFromToolPayload} from "../lib/tool-call-display";
import type {ToolPart,MessagePart} from "../lib/store";

test("actual Cursor partial input reports preparation without exposing input or snapshotting edits",()=>{
 const source=ts.createSourceFile("worker-runner.ts",readFileSync(new URL("../lib/worker-runner.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
 let callback:ts.VariableDeclaration|undefined;
 const walk=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="ingestTool")callback=node;ts.forEachChild(node,walk)};walk(source);assert.ok(callback);
 const js=ts.transpileModule("const "+callback.getText(source)+";\nglobalThis.handle=ingestTool;",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const tools:ToolPart[]=[],parts:MessagePart[]=[],events:Record<string,unknown>[]=[],checkpoints:boolean[]=[];
 let editSnapshots=0,subagentSnapshots=0;
 const context={tools,parts,job:{id:"cursor-run"},agentCwd:"/isolated",canonicalizeToolPart,classifyToolKind,innerToolName,todosFromToolPayload,
  normalizedToolDelta:(event:Record<string,unknown>)=>event,normalizeToolId:(id:string)=>id,resolveMcpToolName:(name:string)=>name,
  isActiveToolStatus:(status:string)=>status==="running",isFinishedToolStatus:(status:string)=>["completed","error"].includes(status),
  toolDetailFromArgs:()=>undefined,extractSubagent:()=>{subagentSnapshots++;return undefined},
  extractEditMetadata:()=>{editSnapshots++;return {}},extractWorkspace:()=>null,extractAutomation:()=>null,
  checkpoint:(force:boolean)=>checkpoints.push(force),emit:(_type:string,event:Record<string,unknown>)=>events.push(event),
  handle:undefined as unknown as (tool:Record<string,unknown>,type:string)=>void};
 vm.runInNewContext(js,context);
 const partial='{"command":';
 context.handle({callId:"a",name:"execute_command",args:partial,status:"running"},"partial-tool-call");
 assert.equal(events[0].phase,"preparing");assert.equal(events[0].inputChars,partial.length);assert.equal(events[0].input,undefined);
 assert.equal(tools[0].input,undefined);assert.equal(editSnapshots,0);assert.equal(subagentSnapshots,0);
 context.handle({callId:"a",name:"execute_command",args:'{"command":"pw',status:"running"},"partial-tool-call");
 assert.deepEqual(checkpoints,[true,false]);
 context.handle({callId:"a",name:"execute_command",args:{command:"pwd"},status:"running"},"tool-call-started");
 assert.equal(tools.length,1);assert.equal(parts.length,1);assert.equal(events.at(-1)?.phase,"executing");
 assert.equal(tools[0].input,'{"command":"pwd"}');
 context.handle({callId:"a",name:"execute_command",status:"running",result:""},"tool-call-completed");
 assert.equal(tools[0].status,"completed");assert.equal(events.at(-1)?.status,"completed");
});
