import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";

const root=mkdtempSync(path.join(os.tmpdir(),"metis-note-pins-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root});
const modules=Promise.all([import("../lib/sqlite"),import("../lib/db-store"),import("../app/api/context/pins/route"),import("../lib/shared-context"),import("../lib/note-pins")]);
const stamp="2026-01-01T00:00:00Z";
function req(method:string,body?:unknown,query="",user="owner"){
 return new Request("http://fixture/api/context/pins"+query,{method,headers:{cookie:"ai_chat_auth="+user+"-token","content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
}
test.after(async()=>{(await modules)[0].getDatabase().close();rmSync(root,{recursive:true,force:true});});
test("pinning with 400 histories changes only pin metadata and pages picker results",async t=>{
 const [sqlite,store,api,notes,pins]=await modules,db=sqlite.getDatabase();
 for(const id of ["owner","member","stranger"]){
  db.prepare("INSERT INTO users VALUES(?,?,?,?,0)").run(id,id,"unused",stamp);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(createHash("sha256").update(id+"-token").digest("hex"),id,"2099-01-01T00:00:00Z");
 }
 sqlite.transaction(()=>{for(let i=0;i<400;i++){
  const id="chat-"+i,title="Chat "+String(i).padStart(4,"0");
  const raw=JSON.stringify({id,ownerId:"owner",title,createdAt:stamp,updatedAt:stamp,sessionState:{input:"preserved draft",goal:"Keep goal"},messages:[{id:"m",role:"user",content:"x".repeat(i===399?4_000_000:8000),createdAt:stamp}]});
  db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run(id,"owner",raw,stamp,stamp);
  db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at,note_pins) VALUES(?,?,?,?,?,?)").run(id,"owner",title,stamp,stamp,"{}");
 }});
 const note=notes.createNote({scope:"global",ownerId:"owner",title:"Pin fixture",content:"Do not edit"});
 const query="?noteId="+note.id+"&picker=1";
 const snapshot=db.prepare("SELECT id,data,updated_at FROM chats ORDER BY id").all();
 await t.test("opening/searching uses a constant number of small queries and 50 choices",async()=>{
  const prepare=db.prepare.bind(db);let count=0;
  db.prepare=((sql:string)=>{count++;assert.doesNotMatch(sql,/SELECT\s+data\s+FROM\s+chats/i);return prepare(sql);}) as typeof db.prepare;
  try{
   const response=await api.GET(req("GET",undefined,query));const body=await response.json();
   assert.equal(response.status,200);assert.equal(body.chats.length,50);assert.equal(body.nextOffset,50);assert.equal(body.totalChats,400);
   assert.equal(body.notes,undefined);assert.ok(count<12,"N+1 pin queries: "+count);
   const found=await api.GET(req("GET",undefined,query+"&search=0399"));
   assert.deepEqual((await found.json()).chats,[{id:"chat-399",title:"Chat 0399"}]);
  }finally{db.prepare=prepare;}
  const seen=new Set<string>();let offset:number|null=0;
  while(offset!==null){const body=await (await api.GET(req("GET",undefined,query+"&offset="+offset))).json();for(const chat of body.chats){assert.ok(!seen.has(chat.id));seen.add(chat.id);}offset=body.nextOffset;}
  assert.equal(seen.size,400);
 });
 await t.test("one selected chat writes once, repeat writes zero and leaves all other histories exact",async()=>{
  const before=db.prepare("SELECT total_changes() AS n").get()!.n as number;
  const response=await api.PATCH(req("PATCH",{noteId:note.id,chatIds:["chat-0"],everywhere:false}));
  assert.equal(response.status,200);assert.equal((await response.json()).changedChats,1);
  const first=db.prepare("SELECT data FROM chats WHERE id='chat-0'").get()!.data as string;
  const parsed=JSON.parse(first);assert.equal(parsed.sessionState.input,"preserved draft");assert.equal(parsed.sessionState.goal,"Keep goal");
  assert.deepEqual(parsed.messages,JSON.parse(snapshot.find(row=>row.id==="chat-0")!.data as string).messages);
  assert.deepEqual(db.prepare("SELECT id,data,updated_at FROM chats WHERE id!='chat-0' ORDER BY id").all(),snapshot.filter(row=>row.id!=="chat-0"));
  const n=db.prepare("SELECT total_changes() AS n").get()!.n;
  const repeat=await api.PATCH(req("PATCH",{noteId:note.id,chatIds:["chat-0"],everywhere:false}));
  assert.equal((await repeat.json()).changedChats,0);assert.equal(db.prepare("SELECT total_changes() AS n").get()!.n,n);
  assert.ok(Number(n)>before);
 });
 await t.test("everywhere is inherited, removes explicit duplicates, preserves per-chat unpin",async()=>{
  let response=await api.PATCH(req("PATCH",{noteId:note.id,everywhere:true}));
  assert.equal((await response.json()).changedChats,1);
  assert.ok(store.getGlobalModelSettings("owner").pinnedNoteIds?.includes(note.id));
  assert.deepEqual(store.getChatNotePins("chat-0","owner")?.pinnedNoteIds,[]);
  response=await api.PATCH(req("PATCH",{scope:"chat",chatId:"chat-0",noteIds:[]}));
  assert.equal(response.status,200);
  assert.ok(store.getChatNotePins("chat-0","owner")?.unpinnedGlobalNoteIds?.includes(note.id));
  response=await api.GET(req("GET",undefined,"?chatId=chat-0"));assert.deepEqual((await response.json()).pinnedNoteIds,[]);
  response=await api.PATCH(req("PATCH",{noteId:note.id,everywhere:false,chatIds:["chat-0"]}));
  assert.equal(response.status,200);assert.deepEqual(store.getChatNotePins("chat-0","owner")?.unpinnedGlobalNoteIds,[]);
 });
 await t.test("more than twenty selected chats survive saves and page boundaries",async()=>{
  const ids=Array.from({length:30},(_,i)=>"chat-"+i);
  const response=await api.PATCH(req("PATCH",{noteId:note.id,everywhere:false,chatIds:ids}));
  assert.equal(response.status,200);assert.equal((await response.json()).chatIds.length,30);
  const body=await (await api.GET(req("GET",undefined,query+"&offset=50"))).json();
  assert.equal(body.configuredChatIds.length,30);
 });
 await t.test("large selected chat writes off-thread; unrelated requests and timers stay responsive",async()=>{
  await api.PATCH(req("PATCH",{noteId:note.id,everywhere:false,chatIds:[]}));
  const parse=JSON.parse;let ticks=0;
  const interval=setInterval(()=>ticks++,5);
  JSON.parse=((raw:string,...rest:unknown[])=>{assert.ok(raw.length<256*1024,"Transcript parsed on HTTP thread");return Reflect.apply(parse,JSON,[raw,...rest]);}) as typeof JSON.parse;
  try{
   const opening=api.PATCH(req("PATCH",{noteId:note.id,everywhere:false,chatIds:["chat-399"]}));
   await new Promise(resolve=>setTimeout(resolve,10));
   const start=performance.now();assert.equal((await api.GET(req("GET",undefined,"?chatId=chat-1"))).status,200);
   assert.ok(performance.now()-start<250);
   const response=await opening;assert.equal(response.status,200);assert.equal((await response.json()).changedChats,1);
   assert.ok(ticks>1);
  }finally{JSON.parse=parse;clearInterval(interval);}
  const after=JSON.parse(db.prepare("SELECT data FROM chats WHERE id='chat-399'").get()!.data as string);
  assert.deepEqual(after.messages,JSON.parse(snapshot.find(row=>row.id==="chat-399")!.data as string).messages);
 });
 await t.test("warm message pagination survives a pin revision and cached full reads refresh",async()=>{
  const chat=store.createChat("Indexed",undefined,"owner");
  store.updateChat(chat.id,{sessionState:{input:"kept"}},"owner");
  const {ensureChatPage}=await import("../lib/chat-page-loader");
  await ensureChatPage(chat.id);
  const chatNote=notes.createNote({scope:"chat",chatId:chat.id,ownerId:"owner",title:"Scoped"});
  const before=db.prepare("SELECT ready_revision,revision FROM chat_page_state WHERE chat_id=?").get(chat.id);
  assert.equal(before!.ready_revision,before!.revision);
  assert.equal((await api.PATCH(req("PATCH",{scope:"chat",chatId:chat.id,noteIds:[chatNote.id]}))).status,200);
  const after=db.prepare("SELECT ready_revision,revision FROM chat_page_state WHERE chat_id=?").get(chat.id);
  assert.equal(after!.ready_revision,after!.revision);
  assert.ok(Number(after!.revision)>Number(before!.revision));
  assert.deepEqual(store.getChatPage(chat.id,"owner",10,0)?.chat.sessionState?.pinnedNoteIds,[chatNote.id]);
  assert.deepEqual(store.getChat(chat.id,"owner")?.sessionState?.pinnedNoteIds,[chatNote.id]);
 });
 await t.test("project pins are personal, preserve settings, respect membership and note ACL",async()=>{
  const projects=await import("../lib/projects"),sharing=await import("../lib/project-sharing");
  const project=projects.createProject({ownerId:"owner"});
  const invite=sharing.inviteProjectMember(project.id,"owner","member");sharing.respondProjectInvitation(invite.id,"member","accept");
  const chat=store.createChat("Shared",undefined,"owner",undefined,{projectId:project.id});
  store.updateChat(chat.id,{sessionState:{input:"owner draft",goal:"owner goal"}},"owner");
  db.prepare("DELETE FROM chat_user_settings WHERE chat_id=? AND user_id=?").run(chat.id,"owner");
  assert.equal((await api.PATCH(req("PATCH",{noteId:note.id,chatIds:[chat.id]}))).status,200);
  assert.equal(store.getChat(chat.id,"owner")?.sessionState?.input,"owner draft");
  assert.equal(store.getChat(chat.id,"owner")?.sessionState?.goal,"owner goal");
  store.updateChat(chat.id,{sessionState:{input:"member draft",goal:"member goal"}},"member");
  const memberNote=notes.createNote({scope:"global",ownerId:"member",title:"Private member note"});
  assert.equal((await api.PATCH(req("PATCH",{noteId:memberNote.id,chatIds:[chat.id]},undefined,"member"))).status,200);
  assert.deepEqual(store.getChatNotePins(chat.id,"owner")?.pinnedNoteIds,[note.id]);
  assert.deepEqual(store.getChatNotePins(chat.id,"member")?.pinnedNoteIds,[memberNote.id]);
  assert.equal(store.getChat(chat.id,"member")?.sessionState?.input,"member draft");
  assert.equal(pins.listPinChats("stranger").some(item=>item.id===chat.id),false);
  assert.equal((await api.PATCH(req("PATCH",{noteId:memberNote.id,chatIds:["chat-1"]}))).status,404);
  sharing.removeProjectMember(project.id,"owner",{userId:"member"});
  assert.equal(pins.listPinChats("member").some(item=>item.id===chat.id),false);
  assert.equal((await api.PATCH(req("PATCH",{scope:"chat",chatId:chat.id,noteIds:[memberNote.id]},undefined,"member"))).status,404);
  assert.equal((await api.GET(new Request("http://fixture/api/context/pins"))).status,401);
 });
});
