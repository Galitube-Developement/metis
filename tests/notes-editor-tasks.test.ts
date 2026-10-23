import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { Fragment } from "@tiptap/pm/model";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { parseNotesMarkdown, serializeNotesMarkdown, notesNodeSignature, type EditorNode } from "../lib/notes-editor-markdown";
import { findNotesTask, notesSelectionSourceId, planNotesTaskIssueConversion } from "../lib/notes-editor-tasks";

test("converting a checkbox atomically removes only that task and retains its permanent issue link", () => {
  const schema = getSchema(notesEditorExtensions());
  const json = schema.nodeFromJSON(parseNotesMarkdown("- [ ] Before\n- [ ] Convert me\n  - nested context\n- [x] After")).toJSON() as EditorNode;
  json.content![0].content![1].attrs!.blockId = "task-stable-1";
  const reloaded = parseNotesMarkdown(serializeNotesMarkdown(json));
  const found = findNotesTask(reloaded,"task-stable-1")!;
  assert.equal(found.task.content![0].content![0].text,"Convert me");
  const plan = planNotesTaskIssueConversion(reloaded,"task-stable-1",notesNodeSignature(found.task),{id:"issue-1",key:"MET-42"})!;
  assert.ok(plan);
  const state = EditorState.create({schema,doc:schema.nodeFromJSON(reloaded)});
  const list = state.doc.child(0);
  const transaction = state.tr.replaceWith(0,list.nodeSize,Fragment.fromArray(plan.nodes.map((node) => schema.nodeFromJSON(node))));
  const updated = state.apply(transaction).doc;
  updated.check();
  assert.deepEqual(updated.content.content.map((node) => node.type.name),["taskList","paragraph","bulletList","taskList"]);
  assert.equal(updated.child(0).textContent,"Before");
  assert.equal(updated.child(1).textContent,"MET-42 Convert me");
  assert.equal(updated.child(1).child(0).marks[0].attrs.href,"issue://issue-1");
  assert.equal(updated.child(2).textContent,"nested context");
  assert.equal(updated.child(3).textContent,"After");
  assert.equal(updated.child(3).child(0).attrs.checked,true);
  assert.equal(findNotesTask(updated.toJSON(),"task-stable-1"),null);
  const saved = schema.nodeFromJSON(parseNotesMarkdown(serializeNotesMarkdown(updated.toJSON())));
  assert.equal(saved.child(1).child(0).marks[0].attrs.href,"issue://issue-1");
});
test("issue conversion refuses to overwrite a task edited or deleted while creation was pending", () => {
  const doc = parseNotesMarkdown("- [ ] Original");
  const task = doc.content![0].content![0];
  task.attrs = {...task.attrs,blockId:"task-stable-2"};
  const expected = notesNodeSignature(task);
  task.content![0].content![0].text = "User changed this while waiting";
  assert.equal(planNotesTaskIssueConversion(doc,"task-stable-2",expected,{id:"issue-2",key:"MET-43"}),null);
  assert.equal(task.content![0].content![0].text,"User changed this while waiting");
  doc.content = [];
  assert.equal(planNotesTaskIssueConversion(doc,"task-stable-2",expected,{id:"issue-2",key:"MET-43"}),null);
});
test("nested checkbox conversion reports its local list path and preserves neighboring document text", () => {
  const doc = parseNotesMarkdown("Before\n\n> - [ ] Nested\n\nAfter");
  const task = doc.content![1].content![0].content![0];
  task.attrs = {...task.attrs,blockId:"nested-task"};
  const plan = planNotesTaskIssueConversion(doc,"nested-task",notesNodeSignature(task),{id:"issue-3",key:"MET-44"})!;
  assert.deepEqual(plan.listPath,[1,0]);
  assert.equal(plan.nodes[0].content![0].text,"MET-44");
  assert.equal(doc.content![0].content![0].text,"Before");
  assert.equal(doc.content![2].content![0].text,"After");
});

test("identical text selections at different block anchors retain distinct issue identities", () => {
  const digest = "same-text-digest";
  const first = notesSelectionSourceId("first-block",1,"first-block",5,digest);
  const second = notesSelectionSourceId("second-block",1,"second-block",5,digest);
  assert.notEqual(first,second);
  assert.equal(first,notesSelectionSourceId("first-block",1,"first-block",5,digest));
  assert.notEqual(first,notesSelectionSourceId("first-block",6,"first-block",10,digest));
  assert.notEqual(first,notesSelectionSourceId("first-block",1,"first-block",5,"changed-text-digest"));
});
