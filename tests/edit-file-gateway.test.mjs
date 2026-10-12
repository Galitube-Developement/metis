import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const directory=fs.mkdtempSync(path.join(os.userInfo().homedir,".metis-edit-gateway-"));
Object.assign(process.env,{AI_CHAT_ROOT:directory,AI_CHAT_MCP_STATE_DIR:path.join(directory,"mcp-state"),
  AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",MCP_BEARER_TOKEN:"synthetic-edit-token"});
const {dispatchGatewayTool,tools}=await import("../lib/mcp-core/gateway-core.mjs");
const user=os.userInfo();
const context={userId:"synthetic-edit-owner",isHostAdmin:true,allowRoot:true,runtimeMode:"agent",
  uid:user.uid,gid:user.gid,osUsername:user.username,home:user.homedir,workspaceRoot:directory};
const call=args=>dispatchGatewayTool("edit_file",args,{context,auditCall:false});
const body=result=>JSON.parse(result.content.filter(c=>c.type==="text").map(c=>c.text).join("\n"));
test("real gateway accepts legacy and batched edits and exposes their schema",async()=>{
  const file=path.join(directory,"sample.txt");fs.writeFileSync(file,"a\nb");
  try{
    const definition=tools.find(t=>t.name==="edit_file");
    assert.ok(definition.inputSchema.properties.edits);assert.ok(definition.inputSchema.properties.dryRun);
    const dry=await call({path:file,edits:[{oldText:"a",newText:"c"},{oldText:"b",newText:"d"}],dryRun:true});
    assert.ok(!dry.isError,JSON.stringify(dry));assert.equal(body(dry).replacements,2);
    assert.equal(fs.readFileSync(file,"utf8"),"a\nb");
    const failure=await call({path:file,edits:[{oldText:"a",newText:"c"},{oldText:"missing",newText:"d"}]});
    assert.equal(failure.isError,true);assert.equal(fs.readFileSync(file,"utf8"),"a\nb");
    const batch=await call({path:file,edits:[{oldText:"a",newText:"c"},{oldText:"b",newText:"d"}]});
    assert.ok(!batch.isError,JSON.stringify(batch));assert.equal(fs.readFileSync(file,"utf8"),"c\nd");
    const legacy=await call({path:file,oldText:"c",newText:"e"});
    assert.ok(!legacy.isError,JSON.stringify(legacy));assert.equal(body(legacy).replacements,1);
    assert.equal(fs.readFileSync(file,"utf8"),"e\nd");
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
