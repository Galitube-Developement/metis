import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { type EditorView } from "@tiptap/pm/view";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { parseNotesMarkdown } from "../lib/notes-editor-markdown";
import { createNotesEditorDropHandler } from "../lib/notes-editor-drop";

function fixture() {
  const schema = getSchema(notesEditorExtensions());
  const json = parseNotesMarkdown("# First **heading**\n\n" + String.fromCharCode(96).repeat(3) + "mermaid\nA-->B\n" + String.fromCharCode(96).repeat(3) + "\n\nLast paragraph");
  json.content!.forEach((node,index) => { node.attrs = {...node.attrs,blockId:"block-"+index}; });
  let state = EditorState.create({schema,doc:schema.nodeFromJSON(json),plugins:[history()]});
  let target: number | null = 1;
  let dispatches = 0;
  const errors: string[] = [], uploaded: File[][] = [];
  const view = {
    get state() { return state; },
    posAtCoords: () => target === null ? null : {pos:target,inside:-1},
    coordsAtPos: () => ({top:100,bottom:120,left:0,right:1}),
    dispatch: (tr:Transaction) => { state = state.apply(tr); dispatches++; },
  } as unknown as EditorView;
  const handler = createNotesEditorDropHandler({noteId:"note-1",onFiles:(files) => {uploaded.push(files);},onError:(message) => errors.push(message)});
  const event = (payload = "", clientY = 140, files:File[] = []) => {
    let prevented = false;
    const value = {
      clientX:20,clientY,
      dataTransfer:{getData:(type:string) => type === "application/x-metis-note-block" ? payload : "",files},
      preventDefault:() => {prevented = true;},
    } as unknown as DragEvent;
    return {value,get prevented(){return prevented;}};
  };
  const position = (index:number) => {let pos=0;for(let i=0;i<index;i++)pos+=state.doc.child(i).nodeSize;return pos;};
  return {view,handler,event,position,errors,uploaded,get state(){return state;},get dispatches(){return dispatches;},setTarget:(pos:number|null) => {target=pos;},apply:(tr:Transaction) => {state=state.apply(tr);}};
}
test("the actual DOM drop callback reorders real ProseMirror blocks, preserving IDs, rich content and undo", {timeout:1000}, () => {
  const f = fixture(), before = f.state.doc, source = before.child(0);
  f.setTarget(f.position(2)+1);
  const event = f.event(JSON.stringify({noteId:"note-1",pos:0}));
  assert.equal(f.handler(f.view,event.value),true);
  assert.equal(event.prevented,true);
  assert.equal(f.dispatches,1);
  f.state.doc.check();
  assert.deepEqual(f.state.doc.content.content.map((node) => node.attrs.blockId),["block-1","block-2","block-0"]);
  assert.ok(f.state.doc.child(2).eq(source),"the exact heading node, attributes and bold marks are moved intact");
  assert.equal(f.state.doc.child(0).attrs.source,before.child(1).attrs.source,"opaque Mermaid source is untouched");
  assert.equal(undo(f.state,(tr) => f.apply(tr)),true);
  assert.ok(f.state.doc.eq(before),"one undo restores every block and its metadata");
});
test("dropping upward maps insertion before the first block without losing raw source", {timeout:1000}, () => {
  const f = fixture(), source = f.state.doc.child(1);
  f.setTarget(1);
  const event = f.event(JSON.stringify({noteId:"note-1",pos:f.position(1)}),105);
  assert.equal(f.handler(f.view,event.value),true);
  assert.deepEqual(f.state.doc.content.content.map((node) => node.attrs.blockId),["block-1","block-0","block-2"]);
  assert.ok(f.state.doc.child(0).eq(source));
});
test("self drops, cross-note drops and missing targets cancel without mutating the document", {timeout:1000}, () => {
  for (const mode of ["self","other-note","missing-target"] as const) {
    const f = fixture(), before = f.state.doc;
    f.setTarget(mode === "missing-target" ? null : 1);
    const event = f.event(JSON.stringify({noteId:mode === "other-note" ? "note-2" : "note-1",pos:0}),105);
    assert.equal(f.handler(f.view,event.value),true);
    assert.equal(event.prevented,true);
    assert.equal(f.dispatches,0);
    assert.ok(f.state.doc.eq(before));
    assert.deepEqual(f.errors,[]);
  }
});
test("malformed block data reports recovery; file and ordinary drops retain their existing routes", {timeout:1000}, () => {
  const f = fixture();
  const malformed = f.event("{broken");
  assert.equal(f.handler(f.view,malformed.value),true);
  assert.equal(f.dispatches,0);
  assert.match(f.errors[0],/Move up or Move down/);
  const file = new File(["sample"],"sample.txt",{type:"text/plain"});
  const upload = f.event("",140,[file]);
  assert.equal(f.handler(f.view,upload.value),true);
  assert.deepEqual(f.uploaded,[[file]]);
  assert.equal(upload.prevented,true);
  const ordinary = f.event();
  assert.equal(f.handler(f.view,ordinary.value),false);
  assert.equal(ordinary.prevented,false);
});
