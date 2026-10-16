import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const dir=mkdtempSync(path.join(os.tmpdir(),"metis-team-read-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,AI_CHAT_ROOT:dir});
delete process.env.AI_CHAT_JOB_ID; delete process.env.AI_CHAT_WORKER_ID; delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
after(()=>rmSync(dir,{recursive:true,force:true}));
test("team GET always returns owned JSON or an explicit JSON error",async t=>{
 const [api,auth,projects,sqlite]=await Promise.all([import("../app/api/projects/[id]/agents/route"),import("../lib/auth"),import("../lib/projects"),import("../lib/sqlite")]);
 const owner=auth.createUser("team-read-owner","test-password"),other=auth.createUser("team-read-other","test-password");
 const cookie="ai_chat_auth="+auth.authenticateUser("team-read-owner","test-password")!.token;
 const otherCookie="ai_chat_auth="+auth.authenticateUser("team-read-other","test-password")!.token;
 const project=projects.createProject({ownerId:owner.id,mode:"agents",name:"Read team"});
 const get=(credential?:string)=>api.GET(new Request("http://test/api/projects/"+project.id+"/agents",{headers:credential?{cookie:credential}:{}}),{params:Promise.resolve({id:project.id})});
 for(const [credential,status] of [[undefined,401],[otherCookie,404],[cookie,200]] as const){
  const r=await get(credential);assert.equal(r.status,status);assert.match(r.headers.get("content-type")!,/application\/json/);
  if(status===200)assert.deepEqual(await r.json(),{agents:[],handoffs:[]});else assert.equal(typeof(await r.json()).error,"string");
 }
 const db=sqlite.getDatabase(),prepare=db.prepare;
 t.mock.method(db,"prepare",function(this:typeof db,sql:string){
  if(sql.includes("SELECT data FROM project_agents"))throw new Error("Simulated team query failure");
  return prepare.call(this,sql);
 });
 const response=await get(cookie);
 assert.equal(response.status,500);
 assert.deepEqual(await response.json(),{error:"Could not load your team. Try again."});
 t.mock.restoreAll();
 assert.equal((await get(cookie)).status,200);
 assert.equal(project.ownerId,owner.id);assert.ok(other.id);
});
