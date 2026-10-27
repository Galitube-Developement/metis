import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
const root=mkdtempSync(path.join(tmpdir(),"metis-startup-projection-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,AI_CHAT_ROOT:root});
delete process.env.AI_CHAT_JOB_ID;delete process.env.AI_CHAT_WORKER_ID;delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
test("warm database startup never extracts metadata from existing large histories; missing activity still backfills",async()=>{
 const [{getDatabase},store]=await Promise.all([import("../lib/sqlite"),import("../lib/db-store")]);
 const db=getDatabase();
 try{
  const chat=store.createChat("Startup fixture");
  store.appendMessage(chat.id,{role:"user",content:"x".repeat(1_000_000)});
  db.prepare("UPDATE chat_activity SET revision=7 WHERE chat_id=?").run(chat.id);
  const run=(guard:boolean)=>spawnSync(process.execPath,["--import","tsx","-e",`
   const {DatabaseSync}=require("node:sqlite");
   const fallback=new DatabaseSync(":memory:");const original=DatabaseSync.prototype.exec;
   if(${guard})DatabaseSync.prototype.exec=function(sql){
    if(!this.__guard){this.__guard=true;this.function("json_extract",{varargs:true,deterministic:true},(...args)=>{
     if(typeof args[0]==="string"&&args[0].length>512*1024)throw new Error("Startup parsed an already projected transcript");
     return fallback.prepare("SELECT json_extract("+args.map(()=>"?").join(",")+") AS value").get(...args).value;
    });}
    return original.call(this,sql);
   };
   require("./lib/sqlite.ts").getDatabase().close();fallback.close();console.log("STARTUP_OK");
  `],{cwd:path.resolve(import.meta.dirname,".."),env:{...process.env},encoding:"utf8",timeout:20000});
  const warm=run(true);
  assert.equal(warm.status,0,warm.stderr);assert.match(warm.stdout,/STARTUP_OK/);
  assert.equal(db.prepare("SELECT revision FROM chat_activity WHERE chat_id=?").get(chat.id)!.revision,7);
  db.prepare("DELETE FROM chat_activity WHERE chat_id=?").run(chat.id);
  const backfill=run(false);assert.equal(backfill.status,0,backfill.stderr);
  assert.equal(db.prepare("SELECT revision FROM chat_activity WHERE chat_id=?").get(chat.id)!.revision,0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
