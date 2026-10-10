import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const data=mkdtempSync(path.join(tmpdir(),"metis-handles-"));
process.env.CHAT_DATA_DIR=data;process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");process.env.AI_CHAT_ROOT=data;process.env.AGENT_CWD=data;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});
const base={displayName:"Handle test",bio:"Private bio",avatar:null,links:[],sharing:false,shareActivity:false};
async function owner(name:string) {
  const auth=await import("../lib/auth");const user=auth.createUser(name,"synthetic-password-123");
  return {...user,token:auth.authenticateUser(name,"synthetic-password-123")!.token};
}
function request(token:string,body:unknown) {
  return new Request("http://localhost/api/profile",{method:"PUT",headers:{cookie:"ai_chat_auth="+token,"content-type":"application/json"},body:JSON.stringify(body)});
}
test("existing profiles gain null handles without changing stored data or legacy URLs",async()=>{
  const {getDatabase}=await import("../lib/sqlite");const {getAccountProfile,getSharedProfile}=await import("../lib/account-profile");
  const user=await owner("handle-legacy"),token="a".repeat(48);
  const {sharing:_sharing,...stored}=base;
  getDatabase().prepare("INSERT INTO account_profiles(owner_id,data,share_id) VALUES(?,?,?)").run(user.id,JSON.stringify(stored),token);
  assert.equal(getAccountProfile(user.id,user.username).handle,null);
  assert.equal(getSharedProfile(token)?.ownerId,user.id);
  assert.equal(getAccountProfile((await owner("handle-new")).id,"New").handle,null);
});
test("handles normalize case and whitespace, stay private, and resolve alongside the original share token",async()=>{
  const {saveAccountProfile,getSharedProfile}=await import("../lib/account-profile");const user=await owner("handle-canonical");
  const original=saveAccountProfile(user.id,{...base,sharing:true});
  const saved=saveAccountProfile(user.id,{...base,handle:"  Das_F1shy312  ",sharing:true});
  assert.equal(saved.handle,"das_f1shy312");assert.equal(saved.shareId,original.shareId);
  assert.equal(getSharedProfile("das_f1shy312")?.ownerId,user.id);
  assert.equal(getSharedProfile("DAS_F1SHY312")?.ownerId,user.id);
  assert.deepEqual(getSharedProfile(saved.shareId!)?.profile,getSharedProfile(saved.handle!)?.profile);
  const privateUser=await owner("handle-private");
  assert.equal(saveAccountProfile(privateUser.id,{...base,handle:"private_handle"}).shareId,null);
  assert.equal(getSharedProfile("private_handle"),null);
});
test("duplicate handles return 409, never disclose ownership, and roll back the entire edit",async()=>{
  const {saveAccountProfile,getAccountProfile}=await import("../lib/account-profile");const route=await import("../app/api/profile/route");
  const first=await owner("handle-first"),second=await owner("handle-second");
  saveAccountProfile(first.id,{...base,handle:"taken_handle"});
  const before=saveAccountProfile(second.id,{...base,handle:"second_handle",sharing:true});
  const response=await route.PUT(request(second.token,{...base,handle:"TAKEN_HANDLE",displayName:"Changed",sharing:false}));
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{error:"This handle is already taken. Choose another one.",field:"handle"});
  assert.deepEqual(getAccountProfile(second.id,second.username),before);
});
test("handle ownership is unique in storage even for competing requests",async()=>{
  const {getDatabase}=await import("../lib/sqlite");const route=await import("../app/api/profile/route");
  const first=await owner("handle-race-a"),second=await owner("handle-race-b");
  const responses=await Promise.all([route.PUT(request(first.token,{...base,handle:"race_handle"})),route.PUT(request(second.token,{...base,handle:"race_handle"}))]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  assert.equal((getDatabase().prepare("SELECT COUNT(*) AS count FROM account_profile_handles WHERE handle=?").get("race_handle") as {count:number}).count,1);
  assert.throws(()=>getDatabase().prepare("INSERT INTO account_profile_handles(handle,owner_id) VALUES(?,?)").run("RACE_HANDLE",second.id));
});
test("invalid handles return field errors; length boundaries, numbers, underscores and hyphens work",async()=>{
  const route=await import("../app/api/profile/route");const {saveAccountProfile,getSharedProfile}=await import("../lib/account-profile");const user=await owner("handle-validation");
  for(const handle of ["ab","a".repeat(33),"_start","-start","has space","a/b","x?y","x#y","éabc","<script>","f".repeat(48)]) {
    const response=await route.PUT(request(user.token,{...base,handle}));assert.equal(response.status,400,handle);assert.equal((await response.json()).field,"handle");
    assert.equal(getSharedProfile(handle),null);
  }
  for(const handle of ["abc","1_a","a-b","a".repeat(32)])assert.equal(saveAccountProfile(user.id,{...base,handle}).handle,handle);
});
test("renaming and clearing handles preserve token URLs; older clients do not erase handles",async()=>{
  const {saveAccountProfile,getSharedProfile}=await import("../lib/account-profile");const user=await owner("handle-rename");
  const first=saveAccountProfile(user.id,{...base,handle:"old_handle",sharing:true});
  const renamed=saveAccountProfile(user.id,{...base,handle:"new_handle",sharing:true});
  assert.equal(renamed.shareId,first.shareId);assert.equal(getSharedProfile("old_handle"),null);
  assert.equal(getSharedProfile(first.shareId!)?.profile.handle,"new_handle");
  assert.equal(saveAccountProfile(user.id,{...base,sharing:true}).handle,"new_handle");
  const cleared=saveAccountProfile(user.id,{...base,handle:"",sharing:true});
  assert.equal(cleared.handle,null);assert.equal(getSharedProfile("new_handle"),null);assert.equal(getSharedProfile(first.shareId!)?.ownerId,user.id);
});
test("revocation disables both URLs and preserves the private handle reservation",async()=>{
  const {saveAccountProfile,getSharedProfile}=await import("../lib/account-profile");const first=await owner("handle-revoke"),second=await owner("handle-other");
  const saved=saveAccountProfile(first.id,{...base,handle:"reserved_handle",sharing:true});
  saveAccountProfile(first.id,{...base,sharing:false});
  assert.equal(getSharedProfile(saved.shareId!),null);assert.equal(getSharedProfile(saved.handle!),null);
  assert.throws(()=>saveAccountProfile(second.id,{...base,handle:saved.handle}));
  const next=saveAccountProfile(first.id,{...base,sharing:true});
  assert.notEqual(next.shareId,saved.shareId);assert.equal(next.handle,saved.handle);assert.equal(getSharedProfile(saved.handle!)?.ownerId,first.id);
});
test("deleting a profile releases its handle through the foreign key",async()=>{
  const {getDatabase}=await import("../lib/sqlite");const {saveAccountProfile}=await import("../lib/account-profile");const first=await owner("handle-delete"),second=await owner("handle-reuse");
  saveAccountProfile(first.id,{...base,handle:"released_handle"});
  getDatabase().prepare("DELETE FROM account_profiles WHERE owner_id=?").run(first.id);
  assert.equal(saveAccountProfile(second.id,{...base,handle:"released_handle"}).handle,"released_handle");
});
