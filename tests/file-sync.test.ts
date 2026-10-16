import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,symlinkSync,mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mergeFileContents } from "../lib/file-sync";
import { runFileIO } from "../lib/file-sync-server";

test("independent edits merge, overlapping edits preserve the exact local draft",()=>{
 const base="first\nmiddle\nlast\n",local="mine\nmiddle\nlast\n",disk="first\nmiddle\ntheirs\n";
 assert.deepEqual(mergeFileContents(base,local,disk),{content:"mine\nmiddle\ntheirs\n",conflict:false});
 assert.deepEqual(mergeFileContents(base,local,"another\nmiddle\nlast\n"),{content:local,conflict:true});
 assert.deepEqual(mergeFileContents(base,base,disk),{content:disk,conflict:false});
 assert.deepEqual(mergeFileContents(base,local,base),{content:local,conflict:false});
 assert.deepEqual(mergeFileContents(base,local,local),{content:local,conflict:false});
});
test("CRLF and final-newline changes are preserved exactly",()=>{
 assert.equal(mergeFileContents("a\r\nb\r\nc\r\n","A\r\nb\r\nc\r\n","a\r\nb\r\nC\r\n").content,"A\r\nb\r\nC\r\n");
 assert.equal(mergeFileContents("a\nb\nc","A\nb\nc","a\nb\nc\n").content,"A\nb\nc\n");
 const huge="x\n".repeat(15001);
 assert.equal(mergeFileContents(huge,"local\n"+huge,huge+"disk\n").conflict,true);
});
test("owner file IO reads complete contents, rejects stale saves, and never recreates deleted files",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-sync-"));
 try{
  const file=path.join(root,"file # % ' $(literal).ts");const content="line\n".repeat(8000)+"x".repeat(150000);writeFileSync(file,content);
  const input={path:file,root};
  const snapshot=await runFileIO({...input,action:"snapshot"},{});
  assert.equal(snapshot.status,200);assert.equal(snapshot.content,content);
  assert.equal((await runFileIO({...input,action:"snapshot",revision:String(snapshot.revision)},{})).unchanged,true);
  writeFileSync(file,"new disk version");
  const conflict=await runFileIO({...input,action:"save",revision:String(snapshot.revision),content:"local draft"},{});
  assert.equal(conflict.status,409);assert.equal(conflict.content,"new disk version");assert.equal(readFileSync(file,"utf8"),"new disk version");
  const saved=await runFileIO({...input,action:"save",revision:String(conflict.revision),content:"merged draft"},{});
  assert.equal(saved.status,200);assert.equal(readFileSync(file,"utf8"),"merged draft");
  rmSync(file);assert.equal((await runFileIO({...input,action:"save",revision:String(saved.revision),content:"draft"},{})).status,404);
  assert.deepEqual(readdirSync(root),[]);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test("concurrent saves admit one version and symlinks cannot escape the workspace",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-sync-race-")),outside=mkdtempSync(path.join(os.tmpdir(),"metis-sync-outside-"));
 try{
  const file=path.join(root,"file.txt");writeFileSync(file,"base");
  const base=await runFileIO({action:"snapshot",path:file,root},{});
  const results=await Promise.all(["left","right"].map(content=>runFileIO({action:"save",path:file,root,revision:String(base.revision),content},{})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert(["left","right"].includes(readFileSync(file,"utf8")));
  assert.deepEqual(readdirSync(root),["file.txt"]);
  const hidden=path.join(outside,"secret.txt");writeFileSync(hidden,"outside");symlinkSync(hidden,path.join(root,"link"));
  assert.equal((await runFileIO({action:"snapshot",path:path.join(root,"link"),root},{})).status,403);
  const target=path.join(root,"inside.txt");writeFileSync(target,"one");symlinkSync(target,path.join(root,"inside-link"));
  const snap=await runFileIO({action:"snapshot",path:path.join(root,"inside-link"),root},{});
  assert.equal((await runFileIO({action:"save",path:path.join(root,"inside-link"),root,revision:String(snap.revision),content:"two"},{})).status,200);
  assert.equal(readFileSync(target,"utf8"),"two");
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}
});
test("binary and oversized snapshots fail without truncating the editor's source",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-sync-bounds-"));
 try{
  const file=path.join(root,"file");writeFileSync(file,Buffer.from([0,1,2]));
  assert.equal((await runFileIO({action:"snapshot",path:file,root},{})).status,415);
  writeFileSync(file,"x".repeat(2_000_001));
  assert.equal((await runFileIO({action:"snapshot",path:file,root},{})).status,413);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test("serialized file IO survives real bundling and minification",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-sync-compiled-"));
 try{
  const require = createRequire(import.meta.url);
  const {transform}=createRequire(require.resolve("tsx/package.json"))("esbuild");
  const {minify}=require("next/dist/compiled/terser");
  const code=await transform(readFileSync(new URL("../lib/file-io-program.mjs",import.meta.url),"utf8"),{loader:"js",format:"esm",target:"node22"});
  const minified=await minify(code.code,{module:true,compress:true,mangle:true});
  const moduleFile=path.join(root,"compiled.mjs");writeFileSync(moduleFile,minified.code!);
  const compiled=await import(pathToFileURL(moduleFile).href);
  const file=path.join(root,"source.txt");writeFileSync(file,"all lines\n");
  const program=compiled.buildFileIOProgram({action:"snapshot",path:file,root});
  const result=JSON.parse(execFileSync(process.execPath,["-"],{input:program,encoding:"utf8"}));
  assert.equal(result.status,200);assert.equal(result.content,"all lines\n");
 }finally{rmSync(root,{recursive:true,force:true})}
});
