import assert from "node:assert/strict";
import test, {before, after} from "node:test";
import {mkdtempSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";

const root=mkdtempSync(path.join(os.tmpdir(),"metis-notification-lifecycle-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false"});
const imports=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/db-questions"),import("../lib/notification-store"),import("../lib/project-sharing"),import("../lib/projects"),import("../lib/sqlite")]);
let modules:Awaited<typeof imports>;
before(async()=>{modules=await imports;});
after(()=>{modules[6].getDatabase().close();rmSync(root,{recursive:true,force:true});});
function fixture(name:string){
 const user=modules[0].createUser("lifecycle-"+name,"password123");
 const chat=modules[1].createChat("Question lifecycle",undefined,user.id);
 return {user,chat};
}
function job(id:string,chatId:string,userId:string,status:string,resetAt?:string){
 modules[6].getDatabase().prepare("INSERT OR REPLACE INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES (?,?,?,?,?,?)")
  .run(id,chatId,userId,JSON.stringify({id,chatId,userId,...(resetAt?{providerRateLimit:{resetAt}}:{})}),status,new Date().toISOString());
}
function questionNotice(userId:string,chatId:string,questionId:string){
 return modules[3].createNotification(userId,{title:"Answer needed",chatId},"run:"+userId+":question:"+questionId);
}
test("answering removes the alert and badge immediately, including delayed observer replay and saved history",async()=>{
 const {user,chat}=fixture("answer"),foreign=fixture("foreign");
 const questions=modules[2],sharing=modules[4],store=modules[3];
 const q=questions.createPendingQuestion([{question:"Continue?",options:["Yes","No"]}],chat.id,user.id);
 try{
  const notice=questionNotice(user.id,chat.id,q.questionId);
  assert.equal(sharing.notificationInbox(user.id).unreadCount,1);
  assert.equal(questions.resolveQuestion(q.questionId,[],user.id),false);
  assert.equal(questions.resolveQuestion(q.questionId,["Yes"],foreign.user.id),false);
  assert.equal(sharing.notificationInbox(user.id).unreadCount,1);
  assert.ok(questions.resolveQuestion(q.questionId,["Yes"],user.id));
  assert.deepEqual(sharing.notificationInbox(user.id),{notifications:[],unreadCount:0});
  assert.equal(questionNotice(user.id,chat.id,q.questionId).id,notice.id);
  assert.equal(sharing.notificationInbox(user.id).unreadCount,0);
  questions.deletePendingQuestion(q.questionId);
  assert.equal(sharing.notificationInbox(user.id).notifications.length,0);
  assert.ok(store.getNotificationFeed(user.id,0).notifications.some(n=>n.id===notice.id),"Delivery history and deduplication remain intact");
  const route=await import("../app/api/notifications/inbox/route");
  const token=modules[0].authenticateUser("lifecycle-answer","password123")!.token;
  const response=await route.GET(new Request("http://localhost/api/notifications/inbox",{headers:{cookie:"ai_chat_auth="+token}}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{notifications:[],unreadCount:0});
 }finally{q.stop();await q.promise;}
});
test("cancelled, expired, deleted and terminal-run questions disappear while another pending question remains",async()=>{
 const {user,chat}=fixture("cancel"),questions=modules[2],sharing=modules[4];
 const forms=Array.from({length:4},()=>questions.createPendingQuestion([{question:"Choose",options:["Yes","No"]}],chat.id,user.id));
 job("terminal-job",chat.id,user.id,"running");
 const terminal=questions.createPendingQuestion([{question:"Choose",options:["Yes","No"]}],chat.id,user.id,{jobId:"terminal-job"});
 try{
  for(const q of [...forms,terminal])questionNotice(user.id,chat.id,q.questionId);
  assert.equal(sharing.notificationInbox(user.id).unreadCount,5);
  questions.cancelQuestion(forms[0].questionId,user.id);
  modules[6].getDatabase().prepare("UPDATE pending_questions SET status='expired',data=json_set(data,'$.status','expired') WHERE question_id=?").run(forms[1].questionId);
  questions.cancelQuestion(forms[2].questionId,user.id);
  questions.deletePendingQuestion(forms[2].questionId);
  for(const status of ["cancelled","error","finished","interrupted"]){
   job("terminal-job",chat.id,user.id,status);
   const inbox=sharing.notificationInbox(user.id);
   assert.equal(inbox.unreadCount,1,status);
   assert.equal(inbox.notifications.length,1,status);
  }
 }finally{for(const q of [...forms,terminal])q.stop();await Promise.all([...forms,terminal].map(q=>q.promise));}
});
test("provider pause notices follow the specific pause, disappear on resume or stop, and preserve other notices",()=>{
 const {user,chat}=fixture("limits"),sharing=modules[4],store=modules[3];
 const resetAt=new Date(Date.now()+3600000).toISOString(),nextReset=new Date(Date.now()+7200000).toISOString();
 job("limited-job",chat.id,user.id,"queued",resetAt);
 const prefix="run:"+user.id+":provider-limit:limited-job:";
 const first=store.createNotification(user.id,{title:"Provider limit reached",chatId:chat.id},prefix+resetAt);
 assert.equal(sharing.notificationInbox(user.id).unreadCount,1);
 job("limited-job",chat.id,user.id,"running",resetAt);
 assert.equal(sharing.notificationInbox(user.id).unreadCount,0);
 job("limited-job",chat.id,user.id,"queued",nextReset);
 const second=store.createNotification(user.id,{title:"Provider limit reached",chatId:chat.id},prefix+nextReset);
 assert.deepEqual(sharing.notificationInbox(user.id).notifications.map(n=>n.id),[second.id]);
 assert.notEqual(first.id,second.id);
 job("limited-job",chat.id,user.id,"cancelled",nextReset);
 const info=store.createNotification(user.id,{title:"Plan ready"});
 assert.deepEqual(sharing.notificationInbox(user.id).notifications.map(n=>n.id),[info.id]);
});
test("accepted, declined, revoked and deleted project invitations leave the inbox; response notices remain",()=>{
 const owner=fixture("inviter").user,recipient=fixture("invitee").user,sharing=modules[4],projects=modules[5];
 for(const action of ["accept","decline","revoke","delete"] as const){
  const project=projects.createProject({ownerId:owner.id,name:"Lifecycle "+action});
  const invite=sharing.inviteProjectMember(project.id,owner.id,"lifecycle-invitee");
  assert.equal(sharing.notificationInbox(recipient.id).unreadCount,1);
  if(action==="revoke")sharing.removeProjectMember(project.id,owner.id,{invitationId:invite.id});
  else if(action==="delete")projects.deleteProject(project.id,owner.id);
  else sharing.respondProjectInvitation(invite.id,recipient.id,action);
  assert.deepEqual(sharing.notificationInbox(recipient.id),{notifications:[],unreadCount:0});
 }
 assert.equal(sharing.notificationInbox(owner.id).notifications.length,2);
});
test("old resolved alerts do not consume the page limit; source ownership and custom messages stay separate",async()=>{
 const {user,chat}=fixture("history"),other=fixture("other"),sharing=modules[4],store=modules[3],questions=modules[2];
 const q=questions.createPendingQuestion([{question:"Continue?",options:["Yes","No"]}],chat.id,user.id);
 const foreign=questions.createPendingQuestion([{question:"Private?",options:["Yes","No"]}],other.chat.id,other.user.id);
 try{
  const active=questionNotice(user.id,chat.id,q.questionId);
  const custom=store.createNotification(user.id,{title:"Answer needed"});
  for(let i=0;i<125;i++)questionNotice(user.id,chat.id,"retired-"+i);
  questionNotice(user.id,chat.id,foreign.questionId);
  const inbox=sharing.notificationInbox(user.id);
  assert.equal(inbox.unreadCount,2);
  assert.deepEqual(new Set(inbox.notifications.map(n=>n.id)),new Set([active.id,custom.id]));
  sharing.markNotificationsRead(user.id,[custom.id]);
  assert.equal(sharing.notificationInbox(user.id).unreadCount,1);
  assert.equal(sharing.notificationInbox(other.user.id).unreadCount,0);
 }finally{q.stop();foreign.stop();await Promise.all([q.promise,foreign.promise]);}
});
