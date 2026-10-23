import test from "node:test";
import assert from "node:assert/strict";
import { createEditorValueSync } from "../lib/editor-value-sync";

test("delayed local echoes never overwrite newer live input",()=>{
 const sync=createEditorValueSync("saved");
 sync.published("a");sync.published("ab");sync.published("abc");
 assert.equal(sync.receive("a"),false);
 assert.equal(sync.receive("ab"),false);
 assert.equal(sync.receive("abc"),false);
 assert.equal(sync.receive("remote"),true);
});
test("coalesced acknowledgements retain external replacements and external undo",()=>{
 const sync=createEditorValueSync("");
 sync.published("first");sync.published("second");
 assert.equal(sync.receive("second"),false);
 assert.equal(sync.receive("first"),true);
 assert.equal(sync.receive("second"),true);
});
test("an unchanged parent value does not reset local edits; an external reset clears stale echoes",()=>{
 const sync=createEditorValueSync("saved");
 sync.published("typed");
 assert.equal(sync.receive("saved"),false);
 assert.equal(sync.receive("remote"),true);
 assert.equal(sync.receive("typed"),true);
});
test("ordered acknowledgements of repeated undo values cannot roll live input back",()=>{
 const sync=createEditorValueSync("saved");
 sync.published("one");sync.published("two");sync.published("one");
 assert.equal(sync.receive("one"),false);
 assert.equal(sync.receive("two"),false);
 assert.equal(sync.receive("one"),false);
 assert.equal(sync.pendingValueCount,0);
 assert.equal(sync.receive("two"),true);
});
test("repeated coalesced undo cycles retain two values rather than every document",()=>{
 const sync=createEditorValueSync("saved");
 for(let i=0;i<10000;i++){sync.published("edited");sync.published("saved");assert.equal(sync.receive("saved"),false);}
 assert.equal(sync.pendingValueCount,2);
 sync.published("new edit");
 assert.equal(sync.receive("new edit"),false);
 assert.equal(sync.pendingValueCount,0);
 assert.equal(sync.receive("external"),true);
});
test("coalescing repeated values remains conservative until a distinct acknowledgement",()=>{
 const sync=createEditorValueSync("saved");
 sync.published("one");sync.published("two");sync.published("one");
 assert.equal(sync.receive("one"),false);
 assert.equal(sync.receive("two"),false);
 sync.published("three");
 assert.equal(sync.receive("three"),false);
 assert.equal(sync.pendingValueCount,0);
 assert.equal(sync.receive("one"),true);
});
