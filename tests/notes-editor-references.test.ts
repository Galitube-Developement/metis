import assert from "node:assert/strict";
import test from "node:test";
import { notesReferenceQuery,notesReferenceHref } from "../lib/notes-editor-references";
import { parseNotesMarkdown,createNotesMarkdownSerializer } from "../lib/notes-editor-markdown";
import { getSchema } from "@tiptap/core";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { ISSUE_BOARD_STATUSES,ISSUE_STATUSES } from "../lib/issue-types";
test("@ queries preserve the replacement range and ignore email addresses",()=>{
 assert.deepEqual(notesReferenceQuery("Hello @Launch plan"),{query:"Launch plan",length:12});
 assert.deepEqual(notesReferenceQuery("@"),{query:"",length:1});
 assert.equal(notesReferenceQuery("name@example.org"),null);
 assert.equal(notesReferenceQuery("text"),null);
});
test("note, canvas and plan links survive Markdown editor round-trips",()=>{
 for(const kind of ["note","canvas","plan"] as const){
  const href=notesReferenceHref({kind,id:"a b"});
  assert.ok(href);
  const source="[A \\[title\\]]("+href+")";
  const parsed=parseNotesMarkdown(source);
  const doc=getSchema(notesEditorExtensions()).nodeFromJSON(parsed);
  assert.equal(createNotesMarkdownSerializer()(doc),source);
 }
 assert.equal(notesReferenceHref({kind:"file",id:"not-a-document"}),null);
});
test("board progression and list priority use their own status ordering",()=>{
 assert.deepEqual(ISSUE_BOARD_STATUSES,["backlog","todo","in_progress","done","canceled"]);
 assert.deepEqual(ISSUE_STATUSES,["in_progress","todo","backlog","done","canceled"]);
 assert.deepEqual(new Set(ISSUE_BOARD_STATUSES),new Set(ISSUE_STATUSES));
});
