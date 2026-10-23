import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteTree, noteAncestors, noteDescendantIds, noteDisplayTitle, notesInContainer, searchNoteTree, type TreeNote } from "../lib/notes-tree";

function note(id: string, parentId: string | null = null, projectId?: string): TreeNote {
  return { id, parentId, projectId, title: id + ".md", content: "", scope: "global", color: "#ffffff", position: {x:0,y:0}, size: {width:280,height:220}, author:"user",createdAt:"2026-01-01",updatedAt:"2026-01-01",archived:false,version:1 };
}
test("note display titles omit Markdown extensions without changing stored names or other extensions", () => {
  const stored = note("Planning");
  assert.equal(noteDisplayTitle(stored.title), "Planning");
  assert.equal(stored.title, "Planning.md");
  assert.equal(noteDisplayTitle("Roadmap.MD"), "Roadmap");
  assert.equal(noteDisplayTitle("Ideas"), "Ideas");
  assert.equal(noteDisplayTitle("report.pdf"), "report.pdf");
  assert.equal(noteDisplayTitle("guide.md examples"), "guide.md examples");
  assert.equal(noteDisplayTitle(""), "");
});

test("each container has an independent tree with duplicate filenames", () => {
  const items = [note("private"), note("private-child","private"), note("project",null,"p"), note("project-child","project","p")];
  items[0].title = items[2].title = "Metis.md";
  assert.equal(buildNoteTree(notesInContainer(items,null))[0].children[0].note.id, "private-child");
  assert.equal(buildNoteTree(notesInContainer(items,"p"))[0].children[0].note.id, "project-child");
  assert.deepEqual(notesInContainer(items,null).map(n=>n.id),["private","private-child"]);
});
test("orphan and corrupt cycle documents remain reachable", () => {
  const tree = buildNoteTree([note("orphan","missing"),note("a","b"),note("b","a")]);
  assert.deepEqual(new Set(tree.map(n=>n.note.id)),new Set(["orphan","a","b"]));
});
test("search keeps the path to a nested match and breadcrumbs are ordered", () => {
  const items=[note("root"),note("child","root"),note("deep","child"),note("other")];
  items[2].content="needle";
  assert.equal(searchNoteTree(buildNoteTree(items),"needle")[0].children[0].children[0].note.id,"deep");
  assert.deepEqual(noteAncestors(items,"deep").map(n=>n.id),["root","child","deep"]);
  assert.deepEqual([...noteDescendantIds(items,"root")],["root","child","deep"]);
});
test("cross-container parent data cannot merge trees", () => {
  const tree=buildNoteTree([note("root",null,"p"),note("private","root")]);
  assert.equal(tree.length,2);
});
