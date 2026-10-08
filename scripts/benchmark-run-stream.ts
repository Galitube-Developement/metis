/** Controlled stream client: no real provider and no production database. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const root=mkdtempSync(path.join(tmpdir(),"metis-stream-perf-"));
process.env.CHAT_DATA_DIR=root;
process.env.CHAT_DB_PATH=path.join(root,"fixture.sqlite");
process.env.AGENT_CWD=root;
async function main(){
  const {getDatabase}=await import("../lib/sqlite");
  const db=getDatabase(), now=new Date().toISOString();
  const store=await import("../lib/db-store");
  const jobs=await import("../lib/db-jobs");
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES('owner','owner','unused',?)").run(now);
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update("fixture-token").digest("hex"),"owner","2099-01-01T00:00:00.000Z");
  const chat=store.createChat("Fixture",undefined,"owner");
  const job=jobs.enqueueJob({chatId:chat.id,userId:"owner",message:"stub"});
  for(let i=0;i<100;i++) jobs.appendRunEvent(job.id,chat.id,"owner","text",{text:"stub-"+i});
  const prepare=db.prepare.bind(db);
  let eventQueries=0;
  db.prepare=((sql:string)=>{if(sql.includes("FROM run_events") && sql.includes("SELECT id")) eventQueries++;return prepare(sql);}) as typeof db.prepare;
  const {GET}=await import("../app/api/runs/route");
  const response=await GET(new Request("http://fixture/api/runs?chatId="+chat.id+"&jobId="+job.id+"&events=1&stream=1",{headers:{cookie:"ai_chat_auth=fixture-token"}}));
  const reader=response.body!.getReader();
  // A stalled client must not continue reading the database or buffering output.
  await new Promise(resolve=>setTimeout(resolve,1100));
  const unreadQueries=eventQueries;
  await reader.read();
  void reader.cancel();
  const atCancel=eventQueries;
  await new Promise(resolve=>setTimeout(resolve,1100));
  console.log(JSON.stringify({unreadQueries,queriesAfterCancel:eventQueries-atCancel,status:response.status}));
  db.close();
  rmSync(root,{recursive:true,force:true});
  // Baseline has an orphaned 30-minute polling loop. Exit only this fixture process.
  process.exit(0);
}
main().catch(error=>{console.error(error);rmSync(root,{recursive:true,force:true});process.exit(1);});
