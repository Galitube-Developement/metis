import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ChatMessage, ToolPart } from "../lib/store";
const directory=mkdtempSync(path.join(os.tmpdir(),"metis-long-chat-"));
process.env.CHAT_DATA_DIR=directory;process.env.CHAT_DB_PATH=path.join(directory,"chat.sqlite");process.env.AGENT_CWD=directory;
const modules=Promise.all([import("../lib/sqlite"),import("../lib/db-store"),import("../app/api/chats/[id]/route"),import("../app/api/chats/[id]/tool-result/route"),import("../app/api/chats/[id]/message/route")]);
test.after(()=>rmSync(directory,{recursive:true,force:true}));
const stamp="2026-01-01T00:00:00.000Z";
const request=(id:string,query="",token="owner-token")=>new Request("http://fixture/api/chats/"+id+query,{headers:{cookie:"ai_chat_auth="+token}});
const params=(id:string)=>({params:Promise.resolve({id})});
test("28 MB legacy history stays responsive, pages indexed data and retains all 400 subagents",async()=>{
 const [{getDatabase},store,api,tools,events]=await modules;
 const db=getDatabase();
 for(const owner of ["owner","stranger"]){
  db.prepare("INSERT INTO users VALUES(?,?,?,?,0)").run(owner,owner,"unused",stamp);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(createHash("sha256").update(owner+"-token").digest("hex"),owner,"2099-01-01T00:00:00Z");
 }
 const pad="x".repeat(11_000);
 const agentTools:ToolPart[]=Array.from({length:400},(_,i)=>({id:"agent-"+i,name:"delegate_subagent",kind:"subagent",status:"completed",input:'{"prompt":"Work"}',result:pad,subagent:{agentId:"child-"+i,title:"Agent "+i,messages:[{role:"assistant",text:pad}],tools:[{id:"nested",name:"read_file",status:"completed",result:pad}]}}));
 const messages:ChatMessage[]=Array.from({length:300},(_,i)=>({id:"message-"+i,role:i%2?"assistant":"user",content:"Message "+i+" "+pad.slice(0,7500),createdAt:stamp}));
 messages[1].tools=[{id:"todo",name:"write_todos",kind:"todo",status:"completed",input:'{"todos":[{"content":"Keep history","status":"in_progress"}]}'}];
 messages.push({id:"coordinator",role:"assistant",content:"Ten-hour result",createdAt:stamp,tools:agentTools,parts:agentTools.map(tool=>({type:"tool",...tool}))});
 const raw=JSON.stringify({id:"large",ownerId:"owner",title:"Legacy",createdAt:stamp,updatedAt:stamp,messages});
 assert.ok(Buffer.byteLength(raw)>28_000_000);
 db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run("large","owner",raw,stamp,stamp);
 // Access projection normally exists on upgrade; create one through the normal
 // writer for a small sibling, and copy its owner scope for the imported fixture.
 store.createChat("Small",undefined,"owner");
 db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?)").run("parent-job","large","owner",JSON.stringify({id:"parent-job",chatId:"large",userId:"owner"}),"completed",stamp);
 for(let i=0;i<400;i++){
  const childId="child-chat-"+i;
  const child=JSON.stringify({id:childId,ownerId:"owner",title:"Child "+i,createdAt:stamp,updatedAt:stamp,messages:[{id:"child-result",role:"assistant",content:"Child result "+i,createdAt:stamp}]});
  db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run(childId,"owner",child,stamp,stamp);
  db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at,run_status) VALUES(?,?,?,?,?,?)").run(childId,"owner","Child "+i,stamp,stamp,"completed");
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?)").run("child-job-"+i,childId,"owner",JSON.stringify({id:"child-job-"+i,chatId:childId,parentJobId:"parent-job",parentChatId:"large",subagentDepth:1}),"completed",stamp);
 }
 db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)").run("large","owner","Legacy",stamp,stamp);
 const small=store.createChat("Other chat",undefined,"owner");
 const {GET:statuses}=await import("../app/api/chats/status/route");
 const statusResponse=await statuses(new Request("http://fixture/api/chats/status?ids="+encodeURIComponent([small.id,"child-chat-0","missing"].join(",")),{headers:{cookie:"ai_chat_auth=owner-token"}}));
 assert.deepEqual((await statusResponse.json()).statuses,{[small.id]:"idle","child-chat-0":"completed",missing:"unavailable"});
 assert.equal((await statuses(new Request("http://fixture/api/chats/status"))).status,401);
 const hidden=await statuses(new Request("http://fixture/api/chats/status?ids=child-chat-0",{headers:{cookie:"ai_chat_auth=stranger-token"}}));
 assert.equal((await hidden.json()).statuses["child-chat-0"],"unavailable");
 const childIds=Array.from({length:101},(_,i)=>"child-"+i).join(",");
 assert.equal((await statuses(new Request("http://fixture/api/chats/status?ids="+encodeURIComponent(childIds),{headers:{cookie:"ai_chat_auth=owner-token"}}))).status,400);
 const original=JSON.parse;
 let ticks=0, maxPause=0,last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();maxPause=Math.max(maxPause,now-last);last=now;ticks++;},5);
 // No large canonical JSON may be transferred/parsed on the web thread, even
 // for first access. The backfill worker has its own isolate and connection.
 JSON.parse=((text:string,...rest:unknown[])=>{
  assert.ok(text.length<512*1024,"Web thread parsed a full transcript");
  return Reflect.apply(original,JSON,[text,...rest]);
 }) as typeof JSON.parse;
 let response:Response;
 let prepareMs=0;
 const start=performance.now();
 try{
  const opening=api.GET(request("large"),params("large"));
  await new Promise(resolve=>setTimeout(resolve,10));
  const otherStart=performance.now();
  const sibling=await api.GET(request(small.id),params(small.id));
  assert.equal(sibling.status,200);assert.ok(performance.now()-otherStart<250);
  response=await opening;prepareMs=performance.now()-start;
  const {GET:todos}=await import("../app/api/chats/[id]/todos/route");
  const todoResponse=await todos(request("large","/todos"),params("large"));
  assert.equal((await todoResponse.json()).currentTodos.items[0].content,"Keep history");
 }finally{JSON.parse=original;clearInterval(timer);}
 assert.equal(response!.status,200);
 assert.ok(ticks>3,"Backfill blocked timers");
 assert.ok(maxPause<250,"Backfill blocked the web event loop: "+maxPause);
 const text=await response!.text(),page=JSON.parse(text);
 assert.ok(Buffer.byteLength(text)<256*1024);
 assert.equal(page.chat.messages.length,10);
 assert.equal(page.totalMessages,301);
 assert.equal(page.currentTodos.items[0].content,"Keep history");
 const tail=page.chat.messages.at(-1);
 assert.ok(tail.tools.length<=24);assert.equal(tail.eventOffset,376);
 assert.equal(tail.tools[0].subagent.messages,undefined);
 assert.equal(tail.tools[0].subagent.agentId,"child-376");
 const ids=new Set(tail.tools.map((tool:ToolPart)=>tool.id));
 let url=tail.eventsUrl;
 while(url){
  const result=await events.GET(new Request("http://fixture"+url,{headers:{cookie:"ai_chat_auth=owner-token"}}),params("large"));
  assert.equal(result.status,200);
  const more=await result.json();
  for(const tool of more.message.tools)ids.add(tool.id);
  url=more.message.eventsUrl;
 }
 assert.equal(ids.size,400);
 assert.equal((db.prepare("SELECT count(*) AS count FROM jobs WHERE json_extract(data,\'$.parentJobId\')=\'parent-job\'").get() as {count:number}).count,400);
 const full=await tools.GET(new Request("http://fixture"+tail.tools[0].resultUrl,{headers:{cookie:"ai_chat_auth=owner-token"}}),params("large"));
 const payload=await full.json();
 assert.equal(payload.result,pad);assert.equal(payload.subagent.messages[0].text,pad);
 assert.equal((await tools.GET(new Request("http://fixture"+tail.tools[0].resultUrl,{headers:{cookie:"ai_chat_auth=stranger-token"}}),params("large"))).status,404);
 assert.equal((db.prepare("SELECT data FROM chats WHERE id='large'").get() as {data:string}).data,raw);
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT preview FROM chat_page_messages WHERE chat_id=? AND position<? ORDER BY position DESC LIMIT 10").all("large",291);
 assert.match(JSON.stringify(plan),/INDEX/);
 // Fixed position cursors survive appends while the reader pages backward.
 store.appendMessage("large",{id:"new",role:"assistant",content:"New result"},"owner");
 let cursor=page.nextMessageBefore;
 const all=new Set(page.chat.messages.map((message:ChatMessage)=>message.id));
 while(cursor>0){
  const earlier=await (await api.GET(request("large","?messageLimit=10&messageBefore="+cursor),params("large"))).json();
  earlier.chat.messages.forEach((message:ChatMessage)=>all.add(message.id));
  assert.ok(earlier.nextMessageBefore<cursor);cursor=earlier.nextMessageBefore;
 }
 assert.equal(all.size,301);assert.ok(!all.has("new"));
 console.log("LONG_CHAT_RESPONSIVE",JSON.stringify({bytes:Buffer.byteLength(text),firstPrepareMs:prepareMs,maxPauseMs:maxPause,ticks,subagents:ids.size}));
});
test("conditional polls, same-timestamp external edits, async metadata and deletion invalidate correctly",async()=>{
 const [{getDatabase},store,api]=await modules;
 const db=getDatabase();
 const first=await api.GET(request("large"),params("large")),etag=first.headers.get("etag")!;
 assert.match(etag,/^"[A-Za-z0-9_-]+"$/,"ETag must be a valid opaque HTTP entity tag");
 const conditional=new Request("http://fixture/api/chats/large",{headers:{cookie:"ai_chat_auth=owner-token","if-none-match":etag}});
 assert.equal((await api.GET(conditional,params("large"))).status,304);
 db.prepare("UPDATE chats SET data=json_set(data,'$.title','External title') WHERE id='large'").run();
 const edited=await api.GET(conditional,params("large"));
 assert.equal(edited.status,200);assert.equal((await edited.json()).chat.title,"External title");
 const beforeCount=(db.prepare("SELECT total FROM chat_page_state WHERE chat_id='large'").get() as {total:number}).total;
 const patch=await api.PATCH(new Request("http://fixture/api/chats/large",{method:"PATCH",headers:{cookie:"ai_chat_auth=owner-token","content-type":"application/json"},body:JSON.stringify({sessionState:{input:"Draft"},title:"Changed"})}),params("large"));
 assert.equal(patch.status,200);assert.deepEqual((await patch.json()).chat.messages,[]);
 const refreshed=await (await api.GET(request("large"),params("large"))).json();
 assert.equal(refreshed.chat.title,"Changed");assert.equal(refreshed.totalMessages,beforeCount);
 store.deleteChat("large","owner");
 assert.equal((await api.GET(request("large"),params("large"))).status,404);
 assert.equal((db.prepare("SELECT count(*) AS count FROM chat_page_messages WHERE chat_id='large'").get() as {count:number}).count,0);
});
