import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { executeFileEdit } from "../remote-client/file-edit.mjs";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"metis-edit-remote-gateway-"));
Object.assign(process.env,{AI_CHAT_ROOT:directory,CHAT_DATA_DIR:directory,CHAT_DB_PATH:path.join(directory,"test.sqlite"),AGENT_CWD:directory});
test("remote batches use a distinct wire action and bounded legacy transport",async t=>{
  const auth=await import("../lib/auth");
  const clients=await import("../lib/remote-clients");
  const gateway=await import("../lib/remote-client-gateway");
  async function fixture(legacy=false,restricted=false) {
    const owner=auth.createUser("edit-"+Math.random().toString(16).slice(2),"synthetic-password");
    const enrollment=clients.registerRemoteClient(clients.createEnrollmentToken(owner.id,undefined,"admin").token,{name:"Synthetic edit client",permissionMode:"admin",os:process.platform})!;
    const client=enrollment.client!;
    clients.updateRemoteClient(client.id,owner.id,{policy:{mode:restricted?"restricted":"full_access",permissions:restricted?["edit_file"]:undefined}});
    const sent:Array<{action:string;params:Record<string,unknown>;requestId:string}>=[];
    const socket=new EventEmitter() as EventEmitter & {readyState:number;send:(raw:string)=>void;close:()=>void};
    socket.readyState=1;
    socket.close=()=>{socket.readyState=3;socket.emit("close");};
    socket.send=raw=>{
      const request=JSON.parse(raw);if(request.type!=="request")return;sent.push(request);
      queueMicrotask(()=>{
        let response:Record<string,unknown>;
        try{
          if(request.action==="edit_file_batch" && legacy)throw new Error("Unsupported remote action: edit_file_batch");
          const result=request.action==="execute_command"?spawnSync("/bin/sh",["-c",request.params.command],{cwd:directory,encoding:"utf8"}):executeFileEdit(fs,request.params);
          if(request.action==="execute_command" && (result as ReturnType<typeof spawnSync>).status!==0)throw new Error(String((result as ReturnType<typeof spawnSync>).stderr));
          response={type:"response",requestId:request.requestId,ok:true,result:request.action==="execute_command"?{stdout:String((result as ReturnType<typeof spawnSync>).stdout)}:result};
        }catch(error){response={type:"response",requestId:request.requestId,ok:false,error:error instanceof Error?error.message:String(error)};}
        socket.emit("message",JSON.stringify(response));
      });
    };
    gateway.attachRemoteClient(socket,client.id,owner.id);
    const file=path.join(directory,client.id+".txt");fs.writeFileSync(file,"one\ntwo");
    return {file,sent,call:(params:Record<string,unknown>)=>{
      const input={clientId:client.id,ownerId:owner.id,action:"edit_file" as const,source:"user" as const,params:{path:file,...params}};
      try { return gateway.requestRemoteClient(input); }
      catch(error){
        if(!(error instanceof clients.RemoteApprovalRequiredError))throw error;
        clients.approveRemoteApproval(error.approvalId,owner.id);
        return gateway.requestRemoteClient({...input,approvalId:error.approvalId});
      }
    }, close(){socket.readyState=3;socket.emit("close");}};
  }
  try {
    await t.test("native batch and dryRun are transported without losing arguments",async()=>{
      const f=await fixture();
      try{
        const edits=[{oldText:"one",newText:"first"},{oldText:"two",newText:"second"}];
        const dry=await f.call({edits,dryRun:true}) as {dryRun:boolean;replacements:number};
        assert.equal(dry.dryRun,true);assert.equal(dry.replacements,2);assert.equal(fs.readFileSync(f.file,"utf8"),"one\ntwo");
        await f.call({edits});assert.equal(fs.readFileSync(f.file,"utf8"),"first\nsecond");
        assert.deepEqual(f.sent.map(r=>r.action),["edit_file_batch","edit_file_batch"]);
      }finally{f.close();}
    });
    await t.test("old clients use the exact validated batch without shell interpolation",async()=>{
      const f=await fixture(true);
      try{
        const text="literal $(touch NEVER) `not-a-command`";
        const result=await f.call({edits:[{oldText:"one",newText:text},{oldText:"two",newText:"done"}]}) as {replacements:number};
        assert.equal(result.replacements,2);assert.equal(fs.readFileSync(f.file,"utf8"),text+"\ndone");
        assert.deepEqual(f.sent.map(r=>r.action),["edit_file_batch","execute_command"]);
        assert.equal(fs.existsSync(path.join(directory,"NEVER")),false);
      }finally{f.close();}
    });
    await t.test("an updated client applies an approved batch under a restricted policy",async()=>{
      const f=await fixture(false,true);
      try{
        await f.call({edits:[{oldText:"one",newText:"approved"}]});
        assert.deepEqual(f.sent.map(r=>r.action),["edit_file_batch"]);
        assert.equal(fs.readFileSync(f.file,"utf8"),"approved\ntwo");
      }finally{f.close();}
    });
    await t.test("an old client under a restricted policy never receives a command fallback",async()=>{
      const f=await fixture(true,true);
      try{
        await assert.rejects(f.call({edits:[{oldText:"one",newText:"first"}]}),/updated remote client/);
        assert.deepEqual(f.sent.map(r=>r.action),["edit_file_batch"]);assert.equal(fs.readFileSync(f.file,"utf8"),"one\ntwo");
      }finally{f.close();}
    });
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
