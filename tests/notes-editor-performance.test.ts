import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { Text } from "@codemirror/state";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { createNotesMarkdownSerializer, parseNotesMarkdown, serializeNotesMarkdown } from "../lib/notes-editor-markdown";
import { markdownLengthChangeFitsLimit } from "../lib/shared-markdown-editor";
const schema=getSchema(notesEditorExtensions());

test("cached PM serialization preserves source, structure changes and undo/redo",()=>{
 const sources=[
  "  \n# Heading\n\nParagraph with **bold**, [a link](https://example.test).\n\n- [ ] Task\n",
  "---\r\ntitle: Example\r\n---\r\n\r\n# Header\r\n\r\nText\r\n",
  "Text\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```mermaid\ngraph LR; A-->B\n```\n",
  "\n\n", "", "First\n\nSecond\n\n<!-- metis:block:stable -->\n",
  "```metis-block\n"+JSON.stringify({type:"toggleBlock",attrs:{title:"Details"},content:[{type:"paragraph",content:[{type:"text",text:"Body"}]}]})+"\n```"
 ];
 for(const source of sources){
  let state=EditorState.create({schema,doc:schema.nodeFromJSON(parseNotesMarkdown(source)),plugins:[history()]});
  const serialize=createNotesMarkdownSerializer();
  const compare=()=>assert.equal(serialize(state.doc),serializeNotesMarkdown(state.doc.toJSON()));
  compare();assert.equal(serialize(state.doc),source);
  if(state.doc.child(0).isTextblock){
   state=state.apply(state.tr.insertText("typed",1));compare();
   state=state.apply(state.tr.insertText(" more",2));compare();
   state=state.apply(state.tr.delete(1,3));compare();
   undo(state,tr=>{state=state.apply(tr);});compare();
   redo(state,tr=>{state=state.apply(tr);});compare();
  }
  state=state.apply(state.tr.insert(state.doc.content.size,schema.nodes.paragraph.create(null,schema.text("new block"))));compare();
  state=state.apply(state.tr.setNodeMarkup(0,undefined,{...state.doc.child(0).attrs,blockId:"new-anchor"}));compare();
 }
});

test("a local edit reuses unchanged block conversions and the guard's document snapshot",()=>{
 let state=EditorState.create({schema,doc:schema.nodeFromJSON(parseNotesMarkdown("First\n\nSecond"))});
 const serialize=createNotesMarkdownSerializer();
 assert.equal(serialize(state.doc),"First\n\nSecond");
 const unchanged=state.doc.child(0);
 Object.defineProperty(unchanged,"toJSON",{value:()=>{throw Error("Unchanged block was converted again");}});
 state=state.apply(state.tr.insertText(" changed",state.doc.content.size-1));
 assert.equal(serialize(state.doc),"First\n\nSecond changed");
 Object.defineProperty(state.doc.child(1),"toJSON",{value:()=>{throw Error("Same document was converted again");}});
 assert.equal(serialize(state.doc),"First\n\nSecond changed");
});

test("source limits use metadata lengths and count CRLF bytes without flattening",()=>{
 for(const separator of ["\n","\r\n"]){
  const doc=Text.of(["alpha","beta","gamma"]);
  const source=doc.sliceString(0,doc.length,separator);
  const length=doc.length+(doc.lines-1)*(separator.length-1);
  assert.equal(length,source.length);
  assert.equal(markdownLengthChangeFitsLimit(length,length+1,length),false);
  assert.equal(markdownLengthChangeFitsLimit(length,length-1,3),true);
  assert.equal(markdownLengthChangeFitsLimit(length,length,length),true);
 }
});
