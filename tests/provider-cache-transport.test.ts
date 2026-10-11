import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("Cursor's real completion metadata preserves cache reads, writes and measured zero",()=>{
 const file=ts.createSourceFile("worker-runner.ts",readFileSync(new URL("../lib/worker-runner.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
 let metadata:ts.ObjectLiteralExpression|undefined;
 function find(node:ts.Node){
  if(ts.isObjectLiteralExpression(node)&&node.properties.some(property=>ts.isPropertyAssignment(property)&&property.name.getText(file)==="providerId"&&property.initializer.getText(file)==='"cursor"'))metadata=node;
  ts.forEachChild(node,find);
 }find(file);assert.ok(metadata);
 const js=ts.transpileModule("globalThis.resultMetadata="+metadata.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 function run(usage:Record<string,number>){
  const context={usage,runConfiguration:{},result:{model:{id:"fixture"}},job:{},chat:{},cursorConnection:{id:"fixture"},parts:[],contextWindow:1000,cursorModel:{contextWindowSource:"provider"},completedAt:"2026-10-01T00:00:00Z",resultMetadata:undefined as unknown as Record<string,unknown>};
  vm.runInNewContext(js,context);return context.resultMetadata;
 }
 const reported=run({inputTokens:100,outputTokens:20,cacheReadTokens:90,cacheWriteTokens:0,totalTokens:120});
 assert.equal(reported.cachedInputTokens,90);assert.equal(reported.cacheWriteInputTokens,0);assert.equal(reported.totalTokens,120);
 const absent=run({inputTokens:100,outputTokens:20});
 assert.equal("cachedInputTokens" in absent,false);assert.equal("cacheWriteInputTokens" in absent,false);
});

test("Antigravity's CLI usage parser retains cache reads instead of dropping them",()=>{
 const file=ts.createSourceFile("official-antigravity.ts",readFileSync(new URL("../lib/providers/official-antigravity.ts",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
 let parser:ts.VariableDeclaration|undefined;
 function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==="usageFrom")parser=node;ts.forEachChild(node,find)}find(file);assert.ok(parser);
 const js=ts.transpileModule("const "+parser.getText(file)+";globalThis.parse=usageFrom;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const context={parse:undefined as unknown as (value:unknown)=>Record<string,unknown>};
 vm.runInNewContext(js,context);
 assert.equal(context.parse({input_tokens:100,output_tokens:20,cached_tokens:90}).cachedInputTokens,90);
 assert.equal(context.parse({input_tokens:100,cached_tokens:0}).cachedInputTokens,0);
 assert.equal("cachedInputTokens" in context.parse({input_tokens:100}),false);
});
