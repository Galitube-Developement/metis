import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileResponse } from "../lib/file-response";
import { fileEmbedMarkdown,parseFileEmbed,fileViewKind,embedFileLinks } from "../lib/file-types";
import { replaceEmbeddedSource } from "../lib/markdown-editor";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-file-embeds-"));
process.env.CHAT_DATA_DIR=root;process.env.CHAT_DB_PATH=path.join(root,"chat.sqlite");process.env.AGENT_CWD=root;
test.after(()=>rmSync(root,{recursive:true,force:true}));
test("video streaming returns its real media type and exact byte ranges for seeking",async()=>{
 const file=path.join(root,"clip.mp4");writeFileSync(file,Buffer.from("0123456789"));
 for(const [range,status,content] of [[null,200,"0123456789"],["bytes=2-5",206,"2345"],["bytes=6-",206,"6789"],["bytes=-3",206,"789"]] as const){
  const response=fileResponse(file,{name:"clip.mp4",mimeType:"application/octet-stream"},new Request("http://test/file",{headers:range?{range}:{}}));
  assert.equal(response.status,status);assert.equal(response.headers.get("content-type"),"video/mp4");
  assert.match(response.headers.get("content-disposition")!,/^inline/);assert.equal(await response.text(),content);
  assert.equal(response.headers.get("content-length"),String(content.length));
 }
 for(const range of ["bytes=10-","bytes=5-2","bytes=-0","bytes=0-1,3-4","bad"]){
  const response=fileResponse(file,{name:"clip.mp4",mimeType:"video/mp4"},new Request("http://test/file",{headers:{range}}));
  assert.equal(response.status,416);assert.equal(response.headers.get("content-range"),"bytes */10");
 }
 assert.match(fileResponse(file,{name:"clip.mp4",mimeType:"video/mp4"},new Request("http://test/file?download=1")).headers.get("content-disposition")!,/^attachment/);
});
test("active uploaded documents are source text rather than executable content",async()=>{
 const file=path.join(root,"document");writeFileSync(file,"<script>alert(1)</script>");
 for(const asset of [{name:"doc.html",mimeType:"text/html"},{name:"image.svg",mimeType:"image/svg+xml"}]){
  const response=fileResponse(file,asset);assert.equal(response.headers.get("content-type"),"text/plain; charset=utf-8");assert.equal(response.headers.get("content-security-policy"),"sandbox");
 }
 assert.equal(fileViewKind("", "data.json"),"text");assert.equal(fileViewKind("", "sound.mp3"),"audio");assert.equal(fileViewKind("", "book.pdf"),"pdf");assert.equal(fileViewKind("", "unknown.bin"),"binary");
});
test("embedding edits and removals preserve surrounding Markdown and reject external source URLs",()=>{
 const file={url:"/api/file-uploads/"+randomUUID()+"/file",name:"data.json",mimeType:"application/json"};
 const source="before\n\n"+fileEmbedMarkdown(file)+"\n\nafter";
 const changed=replaceEmbeddedSource(source,"file",0,JSON.stringify({...file,text:'{"saved":true}',height:320}));
 assert.match(changed,/"saved/);assert.ok(changed.startsWith("before"));assert.ok(changed.endsWith("after"));
 const removed=replaceEmbeddedSource(changed,"file",0,"");assert.equal(removed,"before\n\n\n\nafter");
 assert.equal(parseFileEmbed(JSON.stringify({...file,url:"https://external.invalid"})),null);
 assert.equal(parseFileEmbed(JSON.stringify({...file,url:"javascript:alert(1)"})),null);
 const example="\`\`\`text\n[data.json]("+file.url+")\n\`\`\`";
 assert.equal(embedFileLinks(example),example);
 assert.match(embedFileLinks("[data.json]("+file.url+")"),/^\`\`\`file/);
});
test("owned note and workspace edits persist while original uploads and foreign access remain protected",async()=>{
 const {getDatabase}=await import("../lib/sqlite");
 const {createUpload,appendUpload,completeUpload,uploadedFileResponse}=await import("../lib/file-upload-store");
 const {createNote,getNote}=await import("../lib/shared-context");
 const {createChat,updateChat,getChat}=await import("../lib/db-store");
 const {PATCH:patchNote}=await import("../app/api/notes/[id]/route");
 const {PATCH:patchWorkspace}=await import("../app/api/workspaces/route");
 const {GET:download}=await import("../app/api/file-uploads/[id]/file/route");
 const owner=randomUUID(),other=randomUUID(),token=randomUUID(),otherToken=randomUUID(),db=getDatabase();
 for(const [id,t] of [[owner,token],[other,otherToken]]){
  db.prepare("INSERT INTO users(id,username,password_hash,created_at)VALUES(?,?,?,?)").run(id,id,"unused",new Date().toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at)VALUES(?,?,?)").run(createHash("sha256").update(t).digest("hex"),id,"2099-01-01T00:00:00.000Z");
 }
 const upload=createUpload(owner,{name:"data.json",mimeType:"application/json",size:2});
 await appendUpload(owner,upload.id,0,new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("{}"));c.close();}}));completeUpload(owner,upload.id);
 const spec={...upload,url:"/api/file-uploads/"+upload.id+"/file",text:'{"edited":true}'};
 const note=createNote({ownerId:owner,uploadId:upload.id,kind:"file"});
 const request=(body:unknown,t=token)=>new Request("http://test",{method:"PATCH",headers:{cookie:"ai_chat_auth="+t,"Content-Type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await patchNote(request({content:JSON.stringify(spec),version:note.version}),{params:Promise.resolve({id:note.id})})).status,200);
 assert.equal(parseFileEmbed(getNote(note.id,owner)!.content)?.text,spec.text);
 const chat=createChat("embedding",undefined,owner),wid=randomUUID();
 updateChat(chat.id,{workspaces:[{id:wid,type:"canvas",name:"Files",content:"",version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]},owner);
 assert.equal((await patchWorkspace(request({chatId:chat.id,id:wid,version:1,content:fileEmbedMarkdown(spec)}))).status,200);
 assert.match(getChat(chat.id,owner)!.workspaces![0].content,/"edited/);
 assert.equal((await patchWorkspace(request({chatId:chat.id,id:wid,version:1,content:"stale"}))).status,409);
 assert.equal((await patchWorkspace(request({chatId:chat.id,id:wid,content:"foreign"},otherToken))).status,404);
 assert.equal(await uploadedFileResponse(owner,upload.id).text(),"{}");
 assert.equal((await download(new Request("http://test",{headers:{cookie:"ai_chat_auth="+otherToken}}),{params:Promise.resolve({id:upload.id})})).status,404);
});
