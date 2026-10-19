import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";

const root=mkdtempSync(path.join(tmpdir(),"metis-project-profiles-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:"",CHAT_LEGACY_HEADER_AUTH:"false"});
const modules=Promise.all([import("../lib/auth"),import("../lib/projects"),import("../lib/project-sharing"),import("../lib/account-profile")]);
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(root,{recursive:true,force:true});});
type User={id:string;username:string;token:string};
async function account(username:string):Promise<User>{
 const [auth]=await modules;
 const user=auth.createUser(username,"fixture-password-123");
 return {...user,token:auth.authenticateUser(username,"fixture-password-123")!.token};
}
const profile={displayName:"Display name",bio:"private biography",links:[{label:"Private link",url:"https://example.com/private"}],sharing:false,shareActivity:false};
async function members(projectId:string,user?:User){
 const {GET}=await import("../app/api/projects/[id]/members/route");
 return GET(new Request("http://localhost/api/projects/"+projectId+"/members",{headers:user?{cookie:"ai_chat_auth="+user.token}:{}}),{params:Promise.resolve({id:projectId})});
}

test("project members and pending invitations expose current display names and avatars without private profile fields",async()=>{
 const [,projects,sharing,profiles]=await modules;
 const owner=await account("identity-owner"),member=await account("identity-member"),invited=await account("identity-invited"),stranger=await account("identity-stranger");
 const png="data:image/png;base64,"+(await sharp({create:{width:2,height:2,channels:4,background:"#586575"}}).png().toBuffer()).toString("base64");
 profiles.saveAccountProfile(owner.id,{...profile,displayName:"Elena Weber",avatar:png});
 profiles.saveAccountProfile(invited.id,{...profile,displayName:"Mila Sommer",avatar:png});
 const p=projects.createProject({ownerId:owner.id,name:"Identities"});
 sharing.respondProjectInvitation(sharing.inviteProjectMember(p.id,owner.id,member.username).id,member.id,"accept");
 sharing.inviteProjectMember(p.id,owner.id,invited.username);
 const response=await members(p.id,owner);
 assert.equal(response.status,200);
 assert.equal(response.headers.get("cache-control"),"private, no-store");
 const body=await response.json();
 const shownOwner=body.members.find((item:{userId:string})=>item.userId===owner.id);
 assert.equal(shownOwner.displayName,"Elena Weber");assert.equal(shownOwner.avatar,png);
 assert.deepEqual(Object.keys(shownOwner).sort(),["avatar","displayName","role","userId","username"]);
 const fallback=body.members.find((item:{userId:string})=>item.userId===member.id);
 assert.equal(fallback.displayName,member.username);assert.equal(fallback.avatar,null);
 assert.equal(body.invitations[0].displayName,"Mila Sommer");assert.equal(body.invitations[0].avatar,png);
 assert.deepEqual(Object.keys(body.invitations[0]).sort(),["avatar","displayName","id","status","userId","username"]);
 assert.doesNotMatch(JSON.stringify(body),/private biography|example.com|shareActivity|shareId/);
 assert.deepEqual((await (await members(p.id,member)).json()).invitations,[]);
 assert.equal((await members(p.id,stranger)).status,404);
 assert.equal((await members(p.id)).status,401);
 profiles.saveAccountProfile(owner.id,{...profile,displayName:"Elena Updated",avatar:null});
 const updated=await (await members(p.id,member)).json();
 assert.equal(updated.members.find((item:{userId:string})=>item.userId===owner.id).displayName,"Elena Updated");
 assert.equal(updated.members.find((item:{userId:string})=>item.userId===owner.id).avatar,null);
});

const gif=Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64");
async function upload(user:User){
 const {PUT}=await import("../app/api/profile/avatar/route");
 const response=await PUT(new Request("http://localhost/api/profile/avatar",{method:"PUT",headers:{"content-type":"image/gif",cookie:"ai_chat_auth="+user.token},body:new Uint8Array(gif)}));
 assert.equal(response.status,200);
 return (await response.json()).avatar as string;
}
async function image(avatar:string,user?:User,etag?:string){
 const {GET}=await import("../app/api/profile/avatar/[avatarId]/route");
 const response=await GET(new Request("http://localhost"+avatar,{headers:{...(user?{cookie:"ai_chat_auth="+user.token}:{}),...(etag?{"if-none-match":etag}:{})}}),{params:Promise.resolve({avatarId:avatar.split("/").at(-1)!})});
 const bytes=Buffer.from(await response.arrayBuffer());
 return {status:response.status,headers:response.headers,bytes};
}

test("saved GIFs work for project peers and invitation owners while drafts, strangers and revoked access stay private",async()=>{
 const [,projects,sharing,profiles]=await modules;
 const owner=await account("avatar-owner"),member=await account("avatar-member"),peer=await account("avatar-peer"),invited=await account("avatar-invited"),stranger=await account("avatar-stranger");
 const p=projects.createProject({ownerId:owner.id,name:"Avatar access"});
 for(const user of [member,peer])sharing.respondProjectInvitation(sharing.inviteProjectMember(p.id,owner.id,user.username).id,user.id,"accept");
 const invitation=sharing.inviteProjectMember(p.id,owner.id,invited.username);
 const avatars=new Map<string,string>();
 for(const user of [owner,member,invited]){
  const avatar=await upload(user);avatars.set(user.id,avatar);
  profiles.saveAccountProfile(user.id,{...profile,displayName:user.username+" Display",avatar});
 }
 const ownerAvatar=avatars.get(owner.id)!,memberAvatar=avatars.get(member.id)!,invitedAvatar=avatars.get(invited.id)!;
 for(const [avatar,viewer] of [[ownerAvatar,member],[memberAvatar,owner],[memberAvatar,peer],[invitedAvatar,owner]] as const){
  const loaded=await image(avatar,viewer);
  assert.equal(loaded.status,200);assert.deepEqual(loaded.bytes,gif);
  assert.equal(loaded.headers.get("cache-control"),"private, no-cache");
  assert.equal(loaded.headers.get("vary"),"Cookie");
  assert.equal((await image(avatar,viewer,loaded.headers.get("etag")!)).status,304);
 }
 for(const [avatar,viewer] of [[ownerAvatar,undefined],[ownerAvatar,stranger],[ownerAvatar,invited],[invitedAvatar,member]] as const)assert.equal((await image(avatar,viewer)).status,404);
 const draft=await upload(member);
 assert.equal((await image(draft,owner)).status,404);
 assert.equal((await image(draft,member)).status,200);
 const invitedEtag=(await image(invitedAvatar,owner)).headers.get("etag")!;
 sharing.removeProjectMember(p.id,owner.id,{invitationId:invitation.id});
 const cancelled=await image(invitedAvatar,owner,invitedEtag);
 assert.equal(cancelled.status,404);assert.equal(cancelled.headers.get("cache-control"),"private, no-store");
 const memberEtag=(await image(memberAvatar,owner)).headers.get("etag")!;
 sharing.removeProjectMember(p.id,owner.id,{userId:member.id});
 for(const viewer of [owner,peer])assert.equal((await image(memberAvatar,viewer,memberEtag)).status,404);
 assert.equal((await image(ownerAvatar,member)).status,404);
 assert.equal((await image(ownerAvatar,peer)).status,200);
 const second=projects.createProject({ownerId:owner.id,name:"Another shared project"});
 sharing.respondProjectInvitation(sharing.inviteProjectMember(second.id,owner.id,member.username).id,member.id,"accept");
 assert.equal((await image(memberAvatar,owner)).status,200);
 sharing.removeProjectMember(second.id,member.id,{userId:member.id});
 assert.equal((await image(memberAvatar,owner,memberEtag)).status,404);
});
