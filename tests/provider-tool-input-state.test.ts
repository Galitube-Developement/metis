import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {canonicalizeToolPart} from "../lib/providers/tool-events";
import {upsertToolMessagePart} from "../lib/message-parts";
import type {ToolPart,MessagePart} from "../lib/store";

function fixture(){
 const source=ts.createSourceFile("runner.ts",readFileSync(new URL("../lib/providers/runner.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
 let callback:ts.VariableDeclaration|undefined;
 const walk=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="onTool")callback=node;ts.forEachChild(node,walk)};walk(source);assert.ok(callback);
 const javascript=ts.transpileModule("const "+callback.getText(source)+";\nglobalThis.handle=onTool;",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const tools:ToolPart[]=[],parts:MessagePart[]=[],events:Record<string,unknown>[]=[],checkpoints:boolean[]=[];
 const context={tools,parts,job:{id:"isolated-run"},agentCwd:"/isolated",canonicalizeToolPart,upsertToolMessagePart,
  markProviderProgress(){},withLocalFileEditSnapshot:(tool:ToolPart)=>tool,
  checkpoint:(force:boolean)=>checkpoints.push(force),
  emit:(_type:string,event:Record<string,unknown>)=>events.push(event),handle:undefined as unknown as (tool:ToolPart)=>void};
 vm.runInNewContext(javascript,context);
 return{...context,events,checkpoints,handle:context.handle};
}
test("tool-input counts reach SSE and same-row persistence without per-delta forced checkpoints",()=>{
 const f=fixture();f.handle({id:"a",name:"read_file",status:"running",phase:"preparing",inputChars:0});
 f.handle({id:"a",name:"read_file",status:"running",phase:"preparing",inputChars:123});
 assert.equal(f.tools.length,1);assert.equal(f.parts.length,1);
 assert.equal(f.events.at(-1)?.inputChars,123);assert.equal(f.events.at(-1)?.phase,"preparing");assert.equal(f.events.at(-1)?.source,"mcp");
 assert.deepEqual(f.checkpoints,[true,false]);
 f.handle({id:"a",name:"read_file",status:"running",phase:"executing",input:'{"path":"/tmp/a"}'});
 assert.equal(f.tools.length,1);assert.equal(f.events.at(-1)?.phase,"executing");
 assert.equal(f.checkpoints.at(-1),true);
});
test("late gateway todo resolution replaces provisional input rows and the current checklist",()=>{
 const f=fixture();
 for(const id of ["first","second"]){
  f.handle({id,name:"metis_ai",status:"running",phase:"preparing",inputChars:5});
  f.handle({id,name:"write_todos",kind:"todo",status:"running",phase:"executing",todos:[{content:id,status:"in_progress"}]});
  f.handle({id,name:"write_todos",kind:"todo",status:"completed",result:"ok"});
  assert.equal(f.tools.length,1);assert.equal(f.parts.length,1);
  assert.equal(f.tools[0].id,"todo-isolated-run");
  assert.equal(f.tools[0].todos?.[0].content,id);
  assert.equal(f.tools[0].status,"completed");
 }
});
