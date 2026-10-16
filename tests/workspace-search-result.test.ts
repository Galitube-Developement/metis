import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSearchResult, workspaceSearchCount } from "../lib/workspace-search-result";
import { toolCallHeadline, activityGroupLabel } from "../lib/tool-call-display";
import { toolContractPrompt } from "../lib/agent-control";
const result={type:"text_search",root:"/workspace",pattern:"needle",count:1,matches:[{path:"src/code.ts",absolutePath:"/workspace/src/code.ts",line:4,column:2,text:"needle",context:[{line:3,text:"before"}]}],truncated:false,limits:[],skipped:{binary:1}};
test("structured and wrapped MCP search payloads retain file positions and context",()=>{
 for(const payload of [result,JSON.stringify(result),{content:[{type:"text",text:JSON.stringify(result)}]},{structuredContent:result},{result:{content:[{type:"text",text:JSON.stringify(result)}]}}]){
  const parsed=workspaceSearchResult(payload)!;assert.equal(parsed.entries[0].absolutePath,"/workspace/src/code.ts");assert.equal(parsed.entries[0].line,4);assert.equal(parsed.skipped,1);assert.equal(workspaceSearchCount(parsed),"1 match");
 }
});
test("empty and partial file searches stay distinct from missing or malformed results",()=>{
 const empty=workspaceSearchResult({type:"file_search",root:"/workspace",pattern:"*.tsx",files:[],truncated:false});
 assert.ok(empty);assert.equal(workspaceSearchCount(empty),"0 files");
 const partial=workspaceSearchResult({...result,truncated:true,limits:["results"]})!;
 assert.equal(workspaceSearchCount(partial),"1+ match");
 for(const bad of [null,"not json",{...result,matches:[null]},{...result,matches:[{path:"a",absolutePath:"/a",line:0,text:"bad"}]}])assert.equal(workspaceSearchResult(bad),undefined);
});
test("direct and wrapped searches show search icons, patterns and scopes instead of Read/Command",()=>{
 for(const [name,pattern,verb] of [["grep_search","needle","Grepped"],["file_search","**/*.tsx","Searched"],["repo_search","symbol","Searched"],["mcp__metis_ai__file_search","**/*.tsx","Searched"],["mcp__metis_ai__grep_search","needle","Grepped"]] as const){
  const headline=toolCallHeadline({name,kind:"read",input:JSON.stringify({pattern,path:"/workspace/src"})});
  assert.equal(headline.icon,"search");assert.equal(headline.verb,verb);assert.match(headline.title,new RegExp(verb));
 }
 const wrapped=toolCallHeadline({name:"call_mcp_tool",kind:"mcp",input:JSON.stringify({tool:"grep_search",arguments:{pattern:"needle",path:"/workspace"}})});
 assert.equal(wrapped.title,"Grepped needle");assert.equal(wrapped.icon,"search");
 assert.match(activityGroupLabel([{name:"grep_search",kind:"read"},{name:"file_search",kind:"read"}]),/2 searches/);
});
test("all provider prompt contracts prefer direct search tools when available",()=>{
 for(const provider of ["cursor","codex","claude","alternative-provider"]){
  const prompt=toolContractPrompt({provider,modeId:"agent",toolNames:["grep_search","file_search","read_file","execute_command"]});
  assert.match(prompt,/Prefer grep_search/);assert.match(prompt,/file_search/);assert.match(prompt,/shell search only when/);
  assert.doesNotMatch(prompt,/scoped searches such as rg/);
 }
});
