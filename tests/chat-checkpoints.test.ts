import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root=mkdtempSync(path.join(tmpdir(),"metis-stream-checkpoint-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"fixture.sqlite"),AGENT_CWD:root,AI_CHAT_INSTALL_DIR:path.resolve(import.meta.dirname,"..")});
delete process.env.AI_CHAT_JOB_ID;delete process.env.AI_CHAT_WORKER_ID;delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
const modules=Promise.all([import("../lib/sqlite"),import("../lib/db-store"),import("../lib/chat-page-store")]);
test.after(async()=>{(await modules)[0].getDatabase().close();rmSync(root,{recursive:true,force:true});});

test("indexed submission preserves durable deltas and never hydrates history for context or metadata",async()=>{
 const [{getDatabase,transaction},store]=await modules;const db=getDatabase();
 const chat=store.createChat("Append delta");
 store.upsertMessage(chat.id,{id:"assistant",role:"assistant",content:"Old"});
 store.checkpointAssistantMessage(chat.id,{id:"assistant",role:"assistant",content:"Latest"});
 const {getPinnedNotes,resolveReferences}=await import("../lib/context");
 const prepare=db.prepare.bind(db);
 db.prepare=((sql:string)=>{assert.doesNotMatch(sql,/SELECT data FROM chats WHERE id/,"Submission must not hydrate history");return prepare(sql);}) as typeof db.prepare;
 try{
  assert.deepEqual(getPinnedNotes(undefined,chat.id),[]);
  assert.deepEqual(resolveReferences(undefined,chat.id,[]),[]);
  transaction(()=>store.appendIndexedMessageInTransaction(chat.id,{id:"user",role:"user",content:"Follow up"}));
  store.updateChat(chat.id,{runStatus:"running"},undefined,{metadataProjection:true});
  transaction(()=>store.appendIndexedMessageInTransaction(chat.id,{id:"user",role:"user",content:"Duplicate"}));
 }finally{db.prepare=prepare;}
 assert.deepEqual(store.getChat(chat.id)!.messages.map(m=>m.content),["Latest","Follow up"]);
 assert.deepEqual(store.getChatPage(chat.id,undefined,10,0)!.chat.messages.map(m=>m.content),["Latest","Follow up"]);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_checkpoints WHERE chat_id=?").get(chat.id)!.n,1);
 assert.equal(store.getChatMetadata(chat.id)!.runStatus,"running");
});

test("search rebuild correlates each durable delta with its own message",async()=>{
 const [{getDatabase},store]=await modules;const db=getDatabase();
 const chat=store.createChat("Search deltas");
 for(const [id,content] of [["a","Old alpha"],["b","Old beta"],["c","Stable gamma"]])
  store.upsertMessage(chat.id,{id,role:"assistant",content});
 store.checkpointAssistantMessage(chat.id,{id:"a",role:"assistant",content:"New alpha"});
 store.checkpointAssistantMessage(chat.id,{id:"b",role:"assistant",content:"New beta"});
 const {prepareLegacySearch}=await import("../lib/chat-search-engine");
 const revision=Number(db.prepare("SELECT revision FROM chat_page_state WHERE chat_id=?").get(chat.id)!.revision);
 assert.equal(prepareLegacySearch(db,chat.id,revision),true);
 const rows=db.prepare("SELECT message_id,body FROM chat_search_messages WHERE chat_id=? ORDER BY position").all(chat.id);
 assert.deepEqual(rows.map(r=>[r.message_id,r.body]),[["a","New alpha"],["b","New beta"],["c","Stable gamma"]]);
});

test("streaming checkpoints leave large canonical JSON untouched and update indexed/full/restarted reads",async()=>{
 const [{getDatabase},store,pageStore]=await modules;const db=getDatabase();
 const chat=store.createChat("Synthetic history");
 store.appendMessage(chat.id,{id:"history",role:"user",content:"x".repeat(4_000_000)});
 store.upsertMessage(chat.id,{id:"stream",role:"assistant",content:"Started"});
 const before=String(db.prepare("SELECT data FROM chats WHERE id=?").get(chat.id)!.data);
 let fullReads=0,canonicalWrites=0;const prepare=db.prepare.bind(db);
 db.prepare=((sql:string)=>{if(/SELECT data FROM chats WHERE id/.test(sql))fullReads++;if(/UPDATE chats|INSERT INTO chats/.test(sql))canonicalWrites++;return prepare(sql);}) as typeof db.prepare;
 try{for(let i=1;i<=5;i++)store.checkpointAssistantMessage(chat.id,{id:"stream",role:"assistant",content:"Progress "+i,parts:[{type:"text",content:"Progress "+i}]});}
 finally{db.prepare=prepare;}
 assert.equal(fullReads,0);assert.equal(canonicalWrites,0);
 assert.equal(db.prepare("SELECT data FROM chats WHERE id=?").get(chat.id)!.data,before);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_checkpoints WHERE chat_id=?").get(chat.id)!.n,1);
 assert.equal(store.getChat(chat.id)!.messages.at(-1)!.content,"Progress 5");
 assert.equal(store.getChatPage(chat.id,undefined,10,0)!.chat.messages.at(-1)!.content,"Progress 5");
 assert.equal(store.getChatMetadata(chat.id)!.updatedAt,store.getChat(chat.id)!.updatedAt);
 const restarted=spawnSync(process.execPath,["--import","tsx","-e",`const s=require("./lib/db-store.ts"); console.log(s.getChat(${JSON.stringify(chat.id)}).messages.at(-1).content)`],{cwd:path.resolve(import.meta.dirname,".."),encoding:"utf8",env:{...process.env},timeout:20000});
 assert.equal(restarted.status,0,restarted.stderr);assert.match(restarted.stdout,/Progress 5/);
 // External/old writers may invalidate the index. Preparation must include deltas.
 db.prepare("UPDATE chats SET data=json_set(data,\'$.title\',\'Changed externally\') WHERE id=?").run(chat.id);
 pageStore.rebuildChatPage(db,chat.id);
 assert.equal(store.getChatPage(chat.id,undefined,10,0)!.chat.messages.at(-1)!.content,"Progress 5");
 store.upsertMessage(chat.id,{id:"stream",role:"assistant",content:"Finished"});
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_checkpoints WHERE chat_id=?").get(chat.id)!.n,0);
 assert.equal(JSON.parse(String(db.prepare("SELECT data FROM chats WHERE id=?").get(chat.id)!.data)).messages.at(-1).content,"Finished");
 assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");
});

test("metadata patches, retry boundaries, attachments and revert preserve the intended messages",async()=>{
 const [{getDatabase},store]=await modules;const db=getDatabase(),chat=store.createChat("Boundary");
 const attachment={id:"attachment",name:"example.txt",mimeType:"text/plain",kind:"file" as const,size:3,storedName:"example.txt"};
 store.upsertMessage(chat.id,{id:"first",role:"assistant",content:"Before",attachments:[attachment]});
 const retry={type:"provider-retry" as const,id:"retry",attempt:1,maxRetries:3,message:"Retry",detail:"Temporary provider failure"};
 store.checkpointAssistantMessage(chat.id,{id:"first",role:"assistant",content:"Before retry",parts:[{type:"text",content:"Before retry"},retry]});
 store.updateChat(chat.id,{pinned:true},undefined,{metadataProjection:true});
 assert.equal(store.getChat(chat.id)!.messages[0].content,"Before retry");
 assert.deepEqual(store.getChat(chat.id)!.messages[0].attachments,[attachment]);
 // New assistant attempt consolidates the previous retry before appending.
 store.upsertMessage(chat.id,{id:"second",role:"assistant",content:"Resumed"});
 assert.equal(store.getChat(chat.id)!.messages[0].parts!.at(-1)!.type,"provider-retry");
 assert.deepEqual(store.getChat(chat.id)!.messages.map(m=>m.id),["first","second"]);
 store.checkpointAssistantMessage(chat.id,{id:"second",role:"assistant",content:"Latest"});
 const snapshot=store.getChat(chat.id)!;
 store.saveChat({...snapshot,messages:[snapshot.messages[0]]});
 assert.deepEqual(store.getChat(chat.id)!.messages.map(m=>m.id),["first"]);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_checkpoints WHERE chat_id=?").get(chat.id)!.n,0);
 // A deleted message in an old-version canonical replacement is never resurrected.
 store.upsertMessage(chat.id,{id:"third",role:"assistant",content:"Initial"});
 store.checkpointAssistantMessage(chat.id,{id:"third",role:"assistant",content:"Delta"});
 db.prepare("UPDATE chats SET data=json_remove(data,\'$.messages[1]\') WHERE id=?").run(chat.id);
 assert.deepEqual(store.getChat(chat.id)!.messages.map(m=>m.id),["first"]);
 store.deleteChat(chat.id);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_checkpoints WHERE chat_id=?").get(chat.id)!.n,0);
});
