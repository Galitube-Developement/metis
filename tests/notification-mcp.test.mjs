import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test("notify is a real write tool, enforces owner/mode and forwards the existing internal lease headers",async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-notification-mcp-"));
  Object.assign(process.env,{AI_CHAT_ROOT:dir,AI_CHAT_MCP_STATE_DIR:path.join(dir,"mcp-state"),AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",AI_CHAT_INTERNAL_URL:"http://127.0.0.1:1/api/internal/mcp-question",MCP_BEARER_TOKEN:"fake-token"});
  const {tools,dispatchGatewayTool,modeToolCategory,visibleToolsForContext}=await import("../lib/mcp-core/gateway-core.mjs");
  assert.equal(tools.filter(t=>t.name==="notify").length,1);
  assert.equal(tools.filter(t=>t.name==="customnotify").length,0);
  const schema=tools.find(t=>t.name==="notify").inputSchema;
  assert.deepEqual(Object.keys(schema.properties).sort(),["body","title"]);
  assert.deepEqual(schema.required,["title"]);
  assert.equal(modeToolCategory("notify"),"write");
  let requests=0;
  let notifications=0;
  let releaseGate;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const context={chatId:"fake-chat",userId:"fake-owner",jobId:"fake-job",workerId:"fake-worker",leaseToken:"fake-lease"};
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    requests++;
    assert.equal(new URL(url).port,"1");
    const headers=new Headers(options.headers);
    assert.equal(headers.get("authorization"),"Bearer fake-token");
    assert.equal(headers.get("x-ai-chat-user-id"),context.userId);
    assert.equal(headers.get("x-ai-chat-id"),context.chatId);
    assert.equal(headers.get("x-ai-chat-job-id"),context.jobId);
    assert.equal(headers.get("x-ai-chat-worker-id"),context.workerId);
    assert.equal(headers.get("x-ai-chat-lease-token"),context.leaseToken);
    assert.equal(headers.get("x-chat-password"),null);
    if (options.method === "GET") {
      assert.equal(new URL(url).pathname,"/api/internal/mcp-question");
      return (await gate).clone();
    }
    notifications++;
    assert.equal(new URL(url).pathname,"/api/internal/mcp-notifications");
    assert.deepEqual(JSON.parse(options.body),{title:"Fake only",body:"No notification sent"});
    return Response.json({notification:{id:"fake-notification"}},{status:201});
  });
  const call=(extra={},name="notify")=>dispatchGatewayTool(name,{title:"Fake only",body:"No notification sent"},{context:{...context,...extra},auditCall:false});
  try{
    assert.equal((await call({userId:""})).isError,true);
    assert.equal((await call({jobId:""})).isError,true);
    assert.equal((await call({modePolicy:JSON.stringify({allowedCategories:["read"]})})).isError,true);
    assert.equal(requests,0);
    const pending=call({});
    for(let i=0;i<20 && requests===0;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(requests,1);
    assert.equal(notifications,0,"No tool side effect before the user-answer gate releases");
    releaseGate(Response.json({waitingForUser:false}));
    const result=await pending; assert.ok(!result.isError,JSON.stringify(result));
    assert.equal(requests,2);
    assert.equal(notifications,1);
    const manifest={version:1,ownerId:context.userId,workspaceId:dir,runId:context.jobId,attemptId:"attempt",policyVersion:"1",allowedCategories:["read","write"],toolOverrides:{customnotify:false},childMcpGrants:{}};
    const {capabilityManifestHash}=await import("../lib/capabilities.ts");
    const manifestContext={...context,capabilityManifest:JSON.stringify(manifest),capabilityHash:capabilityManifestHash(manifest)};
    assert(!visibleToolsForContext(manifestContext).some(t=>t.name==="notify"));
    for(const name of ["notify","customnotify"]) {
      assert.equal(modeToolCategory(name),"write");
      for(const extra of [
        {userId:""},
        {jobId:""},
        {modePolicy:JSON.stringify({allowedCategories:["read"]})},
        {modePolicy:JSON.stringify({allowedCategories:["write"],toolOverrides:{notify:false}})},
        {modePolicy:JSON.stringify({allowedCategories:["write"],toolOverrides:{customnotify:false}})},
        {capabilityManifest:JSON.stringify(manifest),capabilityHash:capabilityManifestHash(manifest)},
      ]) assert.equal((await call(extra,name)).isError,true,name+" must honor the same owner and policy checks");
    }
    assert.equal(requests,2,"Rejected calls must have no side effects");
    const legacy=await call({},"customnotify");
    assert.ok(!legacy.isError,JSON.stringify(legacy));
    assert.equal(requests,4);
    assert.equal(notifications,2,"One legacy call creates one notification");
  }finally{rmSync(dir,{recursive:true,force:true});}
});
