import assert from "node:assert/strict";
import test from "node:test";
import { fileChangeDetails,rebaseFileChangeRanges,parseFileChangeRanges } from "../lib/file-change-ranges";
import { editedFileFromTool,editedFilesForMessage } from "../lib/edited-files";
import { workspaceFileHref,parseWorkspaceFileLink } from "../lib/workspace-file-link";
test("ranges describe exact new lines and deletion anchors",()=>{
 const diff=fileChangeDetails("one\nold\nkeep\nbefore\n","one\nnew\nkeep\nafter\n")!;
 assert.equal(diff.additions,2);assert.equal(diff.deletions,2);
 assert.deepEqual(diff.ranges,[{startLine:2,endLine:2,kind:"added",text:"new"},{startLine:4,endLine:4,kind:"added",text:"after"}]);
 assert.deepEqual(fileChangeDetails("one\nremoved\nlast\n","one\nlast\n")!.ranges,[{startLine:2,endLine:2,kind:"deleted",oldStartLine:2,oldEndLine:2}]);
 assert.equal(fileChangeDetails("", "one\ntwo\n")!.ranges[0].endLine,2);
});
test("earlier unchanged edits move through later insertions, later replacements supersede them",()=>{
 const first={startLine:5,endLine:6,kind:"added" as const,text:"five\nsix"};
 assert.deepEqual(rebaseFileChangeRanges([first],[{oldStart:1,oldCount:0,newStart:1,newCount:2}]),[{...first,startLine:7,endLine:8}]);
 assert.deepEqual(rebaseFileChangeRanges([first],[{oldStart:5,oldCount:2,newStart:5,newCount:1}]),[]);
 assert.deepEqual(rebaseFileChangeRanges([first],Array.from({length:100},(_,i)=>({oldStart:i+10,oldCount:1,newStart:i+10,newCount:2}))),[]);
});
test("ranges persist and deep links carry their end line",async()=>{
 const tool={id:"one",name:"edit_file",status:"completed",input:'{"path":"/w/file.ts"}',diff:{before:"one\nold\n",after:"one\nnew\n"}};
 const {compactToolForPersistence}=await import("../lib/tool-persistence");
 const saved=JSON.parse(JSON.stringify(compactToolForPersistence(tool)));
 assert.equal(saved.editedFile.ranges[0].text,"new");
 const href=workspaceFileHref({path:"/w/file.ts",line:2,endLine:4,endColumn:10});
 assert.deepEqual(parseWorkspaceFileLink(href),{path:"/w/file.ts",line:2,endLine:4,endColumn:10});
 assert.deepEqual(parseFileChangeRanges([{startLine:-1,endLine:1,kind:"added"},{startLine:2,endLine:1,kind:"added"}]),[]);
});
