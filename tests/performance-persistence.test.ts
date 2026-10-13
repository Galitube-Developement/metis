import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = mkdtempSync(path.join(tmpdir(), "metis-perf-regression-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "fixture.sqlite");
process.env.AGENT_CWD = root;
process.env.AI_CHAT_ROOT = root;
const modules = Promise.all([import("../lib/sqlite"), import("../lib/db-store"), import("../lib/db-jobs")]);
test.after(async () => { (await modules)[0].getDatabase().close(); rmSync(root,{recursive:true,force:true}); });

test("fresh schema and legacy title-lock migration survive repeated process startup", async () => {
  const [{getDatabase},store] = await modules;
  const db = getDatabase();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get()!.n,0);
  const chat = store.createChat("Legacy");
  db.prepare("UPDATE chats SET data=json_set(data,'$.titleSource','user') WHERE id=?").run(chat.id);
  db.prepare("DELETE FROM meta WHERE key='chat_list_agent_title_lock_v1'").run();
  db.exec("ALTER TABLE chat_list DROP COLUMN agent_title_locked");
  const startup = () => {
    const result = spawnSync(process.execPath,["--import","tsx","-e","require('./lib/sqlite.ts').getDatabase().close()"],{
      cwd:path.resolve(import.meta.dirname,".."),encoding:"utf8",timeout:30_000,
      env:{NODE_ENV:"test",PATH:process.env.PATH,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"fixture.sqlite"),AGENT_CWD:root,AI_CHAT_ROOT:root},
    });
    assert.equal(result.status,0,result.stderr);
  };
  startup();
  assert.equal(db.prepare("SELECT agent_title_locked AS locked FROM chat_list WHERE id=?").get(chat.id)!.locked,1);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='chat_list_agent_title_lock_v1'").get()!.value,"1");
  // A new DB process must not repeat the historical UPDATE.
  db.prepare("UPDATE chat_list SET agent_title_locked=0 WHERE id=?").run(chat.id);
  startup();
  assert.equal(db.prepare("SELECT agent_title_locked AS locked FROM chat_list WHERE id=?").get(chat.id)!.locked,0);
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");
});

test("event queries seek the run index, preserve owner isolation and replay every page", async () => {
  const [{getDatabase},store,jobs] = await modules;
  const db=getDatabase(), now=new Date().toISOString();
  for (const id of ["owner","other"]) db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id,id,"unused",now);
  const chat=store.createChat("Events",undefined,"owner");
  const job=jobs.enqueueJob({chatId:chat.id,userId:"owner",message:"stub"});
  for(let i=0;i<65;i++) jobs.appendRunEvent(job.id,chat.id,"owner","text",{text:String(i)});
  let query="", parameters: unknown[]=[];
  const prepare=db.prepare.bind(db);
  db.prepare=((sql:string)=>{
    const statement=prepare(sql);
    if(sql.includes("FROM run_events") && sql.includes("SELECT id")){
      query=sql;
      const all=statement.all.bind(statement);
      statement.all=((...args: Parameters<typeof statement.all>)=>{parameters=args;return all(...args);}) as typeof statement.all;
    }
    return statement;
  }) as typeof db.prepare;
  try {
    assert.equal(jobs.listRunEvents(chat.id,"owner",0,job.id,32).length,32);
  } finally { db.prepare=prepare; }
  const plan=db.prepare("EXPLAIN QUERY PLAN "+query).all(...parameters as Array<string | number>);
  assert.match(JSON.stringify(plan),/run_events_chat_job_id/);
  assert.equal(jobs.listRunEvents(chat.id,"other",0,job.id).length,0);
  assert.equal(jobs.listRunEvents(chat.id,"owner",0,"missing").length,0);
  const rows: ReturnType<typeof jobs.listRunEvents>=[];
  let after=0;
  for(;;){
    const page=jobs.listRunEvents(chat.id,"owner",after,job.id,32);
    if(!page.length) break;
    rows.push(...page); after=page.at(-1)!.id;
  }
  const text=rows.filter(row=>"event" in row && row.event==="text");
  assert.equal(text.length,65);
  assert.deepEqual(text.map(row=>(row.data as {text:string}).text),Array.from({length:65},(_,i)=>String(i)));
  assert.equal(jobs.listRunEvents(chat.id,undefined,0,job.id).length,rows.length);

  // A foreign user may not obtain a job error from the terminal fallback.
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update("other-token").digest("hex"),"other","2099-01-01T00:00:00.000Z");
  jobs.updateJob(job.id,{status:"error",error:"PRIVATE_FAILURE"});
  const {GET}=await import("../app/api/runs/route");
  const abort=new AbortController();
  const response=await GET(new Request("http://fixture/api/runs?chatId="+chat.id+"&jobId="+job.id+"&events=1&stream=1",{headers:{cookie:"ai_chat_auth=other-token"},signal:abort.signal}));
  const reader=response.body!.getReader();
  const pending=reader.read();
  await new Promise(resolve=>setTimeout(resolve,20));
  abort.abort();
  const result=await pending;
  assert.equal(result.done,true);
});


test("sidebar queue counts track writes, deletes and drains without exposing queued text", async () => {
  const [{getDatabase},store] = await modules;
  const db=getDatabase(), now=new Date().toISOString();
  for (const id of ["queue-owner","queue-other"]) db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id,id,"unused",now);
  const chat=store.createChat("Queue count",undefined,"queue-owner");
  const foreign=store.createChat("Foreign",undefined,"queue-other");
  const snapshot=()=>store.listChatsForUser("queue-owner").find(item=>item.id===chat.id)!;
  assert.equal(snapshot().queuedMessageCount,0);
  store.updateChat(chat.id,{queuedMessages:[{id:"q1",text:"PRIVATE_QUEUE_ONE"},{id:"q2",text:"PRIVATE_QUEUE_TWO"}]},"queue-owner");
  store.updateChat(foreign.id,{queuedMessages:[{id:"foreign-q",text:"OTHER_QUEUE"}]},"queue-other");
  assert.equal(snapshot().queuedMessageCount,2);
  assert.equal(db.prepare("SELECT queued_message_count AS n FROM chat_list WHERE id=?").get(chat.id)!.n,2);
  assert.equal("queuedMessages" in snapshot(),false);
  assert.doesNotMatch(JSON.stringify(store.listChatsForUser("queue-owner")),/PRIVATE_QUEUE|OTHER_QUEUE|Foreign/);
  store.removeQueuedMessage(chat.id,"q1","queue-owner");
  assert.equal(snapshot().queuedMessageCount,1);
  const consumed=store.claimQueuedMessageInTransaction(chat.id,"queue-owner");
  assert.equal(consumed?.message.id,"q2");
  assert.equal(snapshot().queuedMessageCount,0);
  store.updateChat(chat.id,{queuedMessages:[{id:"q3",text:"Later"}]},"queue-owner");
  store.updateChat(chat.id,{queuedMessages:null},"queue-owner");
  assert.equal(snapshot().queuedMessageCount,0);
  assert.equal(store.listChatsForUser("queue-other").find(item=>item.id===foreign.id)?.queuedMessageCount,1);
});

test("legacy sidebar queue-count backfill runs once and preserves chat activity order", async () => {
  const [{getDatabase},store] = await modules;
  const db=getDatabase();
  const chat=store.createChat("Legacy queue");
  store.updateChat(chat.id,{queuedMessages:[{id:"legacy-q1",text:"First"},{id:"legacy-q2",text:"Second"}]});
  const before=store.getChat(chat.id)!;
  db.prepare("DELETE FROM meta WHERE key='chat_list_queued_message_count_v1'").run();
  db.exec("ALTER TABLE chat_list DROP COLUMN queued_message_count");
  const startup=()=>{
    const result=spawnSync(process.execPath,["--import","tsx","-e","require('./lib/sqlite.ts').getDatabase().close()"],{
      cwd:path.resolve(import.meta.dirname,".."),encoding:"utf8",timeout:30_000,
      env:{NODE_ENV:"test",PATH:process.env.PATH,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"fixture.sqlite"),AGENT_CWD:root,AI_CHAT_ROOT:root},
    });
    assert.equal(result.status,0,result.stderr);
  };
  startup();
  assert.equal(db.prepare("SELECT queued_message_count AS n FROM chat_list WHERE id=?").get(chat.id)!.n,2);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='chat_list_queued_message_count_v1'").get()!.value,"1");
  db.prepare("UPDATE chat_list SET queued_message_count=1 WHERE id=?").run(chat.id);
  startup();
  assert.equal(db.prepare("SELECT queued_message_count AS n FROM chat_list WHERE id=?").get(chat.id)!.n,1);
  assert.equal(store.getChat(chat.id)!.updatedAt,before.updatedAt);
  assert.deepEqual(store.getChat(chat.id)!.queuedMessages,before.queuedMessages);
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");
});
