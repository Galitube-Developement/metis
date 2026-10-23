import assert from "node:assert/strict";
import test from "node:test";
import { notesNavigationTarget, subscribeNotesHashNavigation, type NotesNavigationTarget } from "../lib/notes-navigation";

test("fresh note/issue links and explicit focus preserve the intended initial document",()=>{
  assert.deepEqual(notesNavigationTarget("#note-page-a"),{kind:"note",id:"page-a"});
  assert.deepEqual(notesNavigationTarget("#note-page-a/block-anchor_2"),{kind:"note",id:"page-a",blockId:"anchor_2"});
  assert.deepEqual(notesNavigationTarget("#issue-issue-a"),{kind:"issue",id:"issue-a"});
  assert.deepEqual(notesNavigationTarget("#note-page-a/block-anchor_2","page-b"),{kind:"note",id:"page-b"});
  assert.deepEqual(notesNavigationTarget("#note-page-a/block-anchor_2","page-a"),{kind:"note",id:"page-a",blockId:"anchor_2"});
  assert.equal(notesNavigationTarget("#note-%malformed"),null);
  assert.deepEqual(notesNavigationTarget("#note-%malformed","page-b"),{kind:"note",id:"page-b"});
});

test("fragment and Back/Forward navigation open targets without remounting and unsubscribe cleanly",()=>{
  const source=Object.assign(new EventTarget(),{location:{hash:""}});
  const opened:NotesNavigationTarget[]=[];
  const unsubscribe=subscribeNotesHashNavigation(source,target=>opened.push(target));
  // Opening a copied note link while the existing workspace shows its overview.
  source.location.hash="#note-editor-verification";
  source.dispatchEvent(new Event("hashchange"));
  assert.deepEqual(opened.at(-1),{kind:"note",id:"editor-verification"});
  source.location.hash="#note-editor-verification/block-release";
  source.dispatchEvent(new Event("hashchange"));
  assert.deepEqual(opened.at(-1),{kind:"note",id:"editor-verification",blockId:"release"});
  source.location.hash="#issue-review";
  source.dispatchEvent(new Event("popstate"));
  assert.deepEqual(opened.at(-1),{kind:"issue",id:"review"});
  unsubscribe();
  source.location.hash="#note-should-not-open";
  source.dispatchEvent(new Event("hashchange"));source.dispatchEvent(new Event("popstate"));
  assert.equal(opened.length,3);
});
