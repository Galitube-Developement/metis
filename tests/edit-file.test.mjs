import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { normalizeFileEdit, executeFileEdit, buildFileEditProgram } from "../remote-client/file-edit.mjs";

function fixture(content, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "metis-file-edit-"));
  const file = path.join(directory, "unicode `$ file.txt");
  fs.writeFileSync(file, content, { mode: 0o640 });
  fs.chmodSync(file, 0o640);
  try { return callback(file, directory); } finally { fs.rmSync(directory, { recursive:true, force:true }); }
}
test("single replacement remains compatible and preserves UTF-8, BOM, CRLF and file mode", () => {
  fixture("\uFEFFGrüße\r\nold\r\n", file => {
    const before=fs.statSync(file);
    const result=executeFileEdit(fs,{path:file,oldText:"old",newText:"你好"});
    assert.equal(fs.readFileSync(file,"utf8"),"\uFEFFGrüße\r\n你好\r\n");
    assert.equal(result.replacements,1); assert.equal(result.edits[0].firstLine,2);
    assert.equal(result.bytes,fs.statSync(file).size);
    if(process.platform!=="win32"){
      assert.equal(fs.statSync(file).mode&0o777,0o640);
      assert.equal(fs.statSync(file).uid,before.uid);assert.equal(fs.statSync(file).gid,before.gid);
    }
  });
});
test("ordered edits apply once and later edits see previous replacements", () => {
  fixture("alpha alpha\nbeta", file => {
    const r=executeFileEdit(fs,{path:file,edits:[
      {oldText:"alpha",newText:"first",replaceAll:true,expectedOccurrences:2},
      {oldText:"first first",newText:"joined"},{oldText:"beta",newText:""}]});
    assert.equal(fs.readFileSync(file,"utf8"),"joined\n");
    assert.equal(r.replacements,4);assert.deepEqual(r.edits.map(x=>x.replacements),[2,1,1]);
  });
});
test("failed later edit, ambiguous matches and wrong counts leave all bytes unchanged", () => {
  fixture("one one\ntwo", file => {
    for(const edits of [
      [{oldText:"two",newText:"changed"},{oldText:"absent",newText:"x"}],
      [{oldText:"one",newText:"x"}],
      [{oldText:"one",newText:"x",replaceAll:true,expectedOccurrences:3}],
    ]){
      const original=fs.readFileSync(file);assert.throws(()=>executeFileEdit(fs,{path:file,edits}));
      assert.deepEqual(fs.readFileSync(file),original);
    }
    assert.throws(()=>executeFileEdit(fs,{path:file,edits:[{oldText:"two",newText:"x"},{oldText:"missing",newText:"y"}]}),/Edit 2:/);
  });
  fixture("aaa",file=>assert.throws(()=>executeFileEdit(fs,{path:file,oldText:"aa",newText:"b"}),/not unique/));
});
test("dryRun and no-op edits preserve content, inode and modification time", () => {
  fixture("old",file=>{
    const stat=fs.statSync(file);
    const r=executeFileEdit(fs,{path:file,edits:[{oldText:"old",newText:"new"}],dryRun:true});
    assert.equal(r.changed,false);assert.equal(r.wouldChange,true);assert.equal(r.dryRun,true);
    assert.equal(fs.readFileSync(file,"utf8"),"old");
    executeFileEdit(fs,{path:file,oldText:"old",newText:"old"});
    assert.equal(fs.statSync(file).ino,stat.ino);assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);
    assert.throws(()=>executeFileEdit(fs,{path:file,oldText:"absent",newText:"x",dryRun:true}));
  });
});
test("malformed requests and invalid UTF-8 fail before changing files", () => {
  fixture("original",file=>{
    for(const request of [
      {edits:[]},{edits:"bad"},{oldText:"",newText:"x"},{oldText:"original"},
      {oldText:"original",newText:"x",edits:[{oldText:"a",newText:"b"}]},
      {oldText:"original",newText:"x",replaceAll:"true"},
      {oldText:"original",newText:"x",expectedOccurrences:0},
      {oldText:"original",newText:"x",dryRun:"true"},
    ]){
      assert.throws(()=>executeFileEdit(fs,{path:file,...request}));
      assert.equal(fs.readFileSync(file,"utf8"),"original");
    }
    assert.throws(()=>normalizeFileEdit({path:file,edits:Array(101).fill({oldText:"a",newText:"b"})}));
    fs.writeFileSync(file,Buffer.from([0xff,0x61]));const original=fs.readFileSync(file);
    assert.throws(()=>executeFileEdit(fs,{path:file,oldText:"a",newText:"b"}),/UTF-8/);
    assert.deepEqual(fs.readFileSync(file),original);
  });
});
test("write failure and external changes do not clobber originals and clean temporary files", () => {
  fixture("old",(file,directory)=>{
    assert.throws(()=>executeFileEdit({...fs,renameSync(){throw new Error("simulated write failure");}},
      {path:file,oldText:"old",newText:"new"}),/simulated write failure/);
    assert.equal(fs.readFileSync(file,"utf8"),"old");
    let stats=0;
    const io={...fs,statSync(p){if(++stats===2)fs.writeFileSync(file,"external");return fs.statSync(p);}};
    assert.throws(()=>executeFileEdit(io,{path:file,oldText:"old",newText:"new"}),/File changed/);
    assert.equal(fs.readFileSync(file,"utf8"),"external");
    assert.deepEqual(fs.readdirSync(directory),[path.basename(file)]);
  });
});
test("mapped identity can edit its file but cannot replace a read-only file", {skip:process.platform!=="linux" || process.getuid?.()!==0},()=>{
  fixture("old",(file,directory)=>{
    const fields=fs.readFileSync("/etc/passwd","utf8").split("\n").find(line=>line.startsWith("nobody:")).split(":");
    const uid=Number(fields[2]),gid=Number(fields[3]);
    fs.chownSync(directory,uid,gid);fs.chmodSync(directory,0o700);fs.chownSync(file,uid,gid);
    const run=()=>spawnSync(process.execPath,["-"],{uid,gid,input:buildFileEditProgram({path:file,edits:[{oldText:"old",newText:"new"}]}),encoding:"utf8"});
    fs.chmodSync(file,0o400);const blocked=run();assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/EACCES/);
    assert.equal(fs.readFileSync(file,"utf8"),"old");
    fs.chmodSync(file,0o600);const edited=run();assert.equal(edited.status,0,edited.stderr);
    assert.equal(fs.readFileSync(file,"utf8"),"new");assert.equal(fs.statSync(file).uid,uid);
  });
});
test("generated mapped-identity program handles large inputs and literal shell syntax via stdin", () => {
  fixture("old",file=>{
    const replacement="ä".repeat(100000)+" $(touch NEVER) `literal`";
    const result=spawnSync(process.execPath,["-"],{input:buildFileEditProgram({path:file,oldText:"old",newText:replacement}),encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).changed,true);
    assert.equal(fs.readFileSync(file,"utf8"),replacement);
    assert.equal(fs.existsSync("NEVER"),false);
  });
});
test("symlinks preserve their link and edit the target atomically", {skip:process.platform==="win32"},()=>{
  fixture("old",(file,directory)=>{
    const link=path.join(directory,"link");fs.symlinkSync(file,link);
    executeFileEdit(fs,{path:link,oldText:"old",newText:"new"});
    assert.equal(fs.lstatSync(link).isSymbolicLink(),true);assert.equal(fs.readFileSync(file,"utf8"),"new");
  });
});
