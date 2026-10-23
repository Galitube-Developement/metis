import assert from "node:assert/strict";
import test, {before,after} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-issuebooks-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"test.sqlite"),AGENT_CWD:root,NODE_ENV:"test",CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:""});
const modules=Promise.all([import("../lib/auth"),import("../lib/projects"),import("../lib/shared-context"),import("../lib/issues"),import("../lib/sqlite"),import("../lib/project-sharing")]);
let m:Awaited<typeof modules>,owner:string,member:string,stranger:string,projectId:string,token:string;
before(async()=>{
 m=await modules;owner=m[0].createUser("issuebook-owner","password123").id;member=m[0].createUser("issuebook-member","password123").id;stranger=m[0].createUser("issuebook-stranger","password123").id;
 projectId=m[1].createProject({ownerId:owner,name:"Issuebooks"}).id;
 const invitation=m[5].inviteProjectMember(projectId,owner,"issuebook-member");m[5].respondProjectInvitation(invitation.id,member,"accept");
 token=m[0].authenticateUser("issuebook-owner","password123")!.token;
});
after(()=>{m?.[4].getDatabase().close();rmSync(root,{recursive:true,force:true});});

test("independent issuebooks contain actual Markdown children, with shared project access",()=>{
 const a=m[2].createNote({ownerId:member,projectId,kind:"issuebook",title:"Product"});
 const b=m[2].createNote({ownerId:owner,projectId,kind:"issuebook",title:"Bugs"});
 assert.equal(a.kind,"issuebook");assert.equal(a.ownerId,owner);
 const issue=m[3].createIssue(member,{projectId,issuebookId:a.id,title:"Save drafts",description:"## Steps\n\n- [ ] Save the draft"});
 const second=m[3].createIssue(owner,{projectId,issuebookId:b.id,title:"Separate"});
 const note=m[2].getNote(issue.noteId!,member)!;
 assert.equal(note.parentId,a.id);assert.equal(note.issueId,issue.id);assert.equal(note.content,issue.description);assert.equal(note.title,issue.title);
 assert.equal(note.ownerId,owner);assert.equal(m[2].getNote(note.id,stranger),null);
 assert.deepEqual(m[3].listIssues(owner,{projectId,issuebookId:a.id}).map(i=>i.id),[issue.id]);
 assert.deepEqual(m[3].listIssues(owner,{projectId,issuebookId:b.id}).map(i=>i.id),[second.id]);
 assert.equal(m[2].listNotes({ownerId:member,projectId,parentId:a.id})[0].id,note.id);
});

test("Markdown and issue edits synchronize both directions with optimistic concurrency and rollback",()=>{
 const issue=m[3].createIssue(owner,{title:"Before",description:"Original",status:"todo"});
 const note=m[2].getNote(issue.noteId!,owner)!;
 m[2].updateNote(note.id,{ownerId:owner,title:"From Markdown",content:"# Updated\n\nBody\n",expectedVersion:note.version});
 const updated=m[3].getIssue(issue.id,owner)!;
 assert.equal(updated.title,"From Markdown");assert.equal(updated.description,"# Updated\n\nBody\n");assert.equal(updated.version,2);
 assert.throws(()=>m[3].updateIssue(issue.id,owner,{title:"Stale",expectedVersion:issue.version}),/changed/);
 const before=m[2].getNote(note.id,owner)!;
 const next=m[3].updateIssue(issue.id,owner,{title:"From issue",description:"## Final",status:"done",expectedVersion:updated.version});
 assert.equal(m[2].getNote(note.id,owner)!.content,"## Final");
 assert.throws(()=>m[2].updateNote(note.id,{ownerId:owner,content:"Stale",expectedVersion:before.version}),/changed/);
 assert.throws(()=>m[2].updateNote(note.id,{ownerId:owner,parentId:null,title:"Lost"}),/issuebook/);
 assert.equal(m[3].getIssue(issue.id,owner)!.title,next.title);
 assert.equal(m[2].getNote(note.id,owner)!.parentId,next.issuebookId);
 assert.ok(m[3].getIssueDetail(issue.id,owner).history.some(h=>h.changes.description?.after==="# Updated\n\nBody\n"));
});

test("migration retains original issue IDs, comments, source and full Markdown without duplicates",()=>{
 const source=m[2].createNote({ownerId:owner,title:"Source",content:"- [ ] Legacy"});
 const original=m[3].createIssue(owner,{title:"L".repeat(280),description:"d".repeat(75_000),source:{noteId:source.id,sourceId:"legacy",kind:"checkbox"}});
 m[3].addIssueComment(original.id,owner,"Keep this comment");
 const db=m[4].getDatabase();
 // Simulate an existing canonical issue before issuebooks were introduced.
 db.prepare("DELETE FROM notes WHERE id=?").run(original.noteId!);
 db.prepare("UPDATE issues SET data=json_remove(data,'$.noteId','$.issuebookId') WHERE id=?").run(original.id);
 const migrated=m[3].listAccessibleIssues(owner).find(i=>i.id===original.id)!;
 assert.equal(migrated.key,original.key);assert.deepEqual(migrated.source,original.source);
 assert.equal(m[3].getIssueDetail(original.id,owner).comments[0].body,"Keep this comment");
 const doc=m[2].getNote(migrated.noteId!,owner)!;
 assert.equal(doc.title,original.title);assert.equal(doc.content,original.description);
 m[2].updateNote(doc.id,{ownerId:owner,content:doc.content+"!",expectedVersion:doc.version});
 assert.equal(m[3].getIssue(original.id,owner)!.description.length,75_001);
 const again=m[3].listAccessibleIssues(owner).find(i=>i.id===original.id)!;
 assert.equal(again.noteId,migrated.noteId);
 assert.equal(m[2].listNotes({ownerId:owner}).filter(n=>n.issueId===original.id).length,1);
});

test("book boundaries, deletion and trash keep the two representations consistent",()=>{
 const book=m[2].createNote({ownerId:owner,kind:"issuebook",title:"Work"});
 const other=m[2].createNote({ownerId:owner,kind:"issuebook",title:"Other"});
 const normal=m[2].createNote({ownerId:owner,title:"Normal"});
 assert.throws(()=>m[3].createIssue(stranger,{issuebookId:book.id,title:"Injected"}),/issuebook/);
 assert.throws(()=>m[3].createIssue(owner,{issuebookId:normal.id,title:"Wrong type"}),/issuebook/);
 const issue=m[3].createIssue(owner,{issuebookId:book.id,title:"Task"});
 m[2].updateNote(issue.noteId!,{ownerId:owner,parentId:other.id});
 assert.equal(m[3].getIssue(issue.id,owner)!.issuebookId,other.id);
 m[2].updateNote(other.id,{ownerId:owner,archived:true});
 assert.throws(()=>m[3].createIssue(owner,{issuebookId:other.id,title:"Archived"}),/issuebook/);
 m[2].updateNote(other.id,{ownerId:owner,archived:false});
 assert.equal(m[3].listIssues(owner,{issuebookId:other.id}).length,1);
 assert.throws(()=>m[2].moveNote(other.id,{ownerId:owner,projectId,parentId:null}),/original project/);
 assert.throws(()=>m[2].deleteNote(other.id,owner),/trash/);
 m[3].deleteIssue(issue.id,owner);
 assert.equal(m[2].getNote(issue.noteId!,owner),null);assert.equal(m[3].getIssue(issue.id,owner),null);
 assert.equal(m[2].getNote(normal.id,owner)!.kind,"note");
});

test("API creates issuebooks and exposes linked Markdown files with auth enforced",async()=>{
 const notes=await import("../app/api/notes/route"),issues=await import("../app/api/issues/route");
 const req=(url:string,body?:unknown)=>new Request("http://localhost"+url,{method:body?"POST":"GET",headers:{cookie:"ai_chat_auth="+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const response=await notes.POST(req("/api/notes",{kind:"issuebook",title:"API book",projectId}));
 assert.equal(response.status,201);const {note:book}=await response.json();assert.equal(book.kind,"issuebook");
 const created=await issues.POST(req("/api/issues",{projectId,issuebookId:book.id,title:"API task"}));
 assert.equal(created.status,201);const {issue}=await created.json();
 const listing=await issues.GET(req("/api/issues?projectId="+projectId+"&issuebookId="+book.id));
 assert.deepEqual((await listing.json()).issues.map((i:{id:string})=>i.id),[issue.id]);
 const files=await notes.GET(req("/api/notes?projectId="+projectId+"&parentId="+book.id));
 assert.equal((await files.json()).notes[0].id,issue.noteId);
 assert.equal((await issues.GET(new Request("http://localhost/api/issues?issuebookId="+book.id))).status,401);
});
