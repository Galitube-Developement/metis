import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-note-hierarchy-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "test.sqlite");
process.env.AGENT_CWD = dataDir;

const imports = Promise.all([
  import("../lib/sqlite"),
  import("../lib/shared-context"),
  import("../app/api/notes/route"),
  import("../app/api/notes/[id]/route"),
  import("../app/api/notes/[id]/move/route"),
  import("../app/api/notes/[id]/export/route"),
  import("../lib/db-store"),
  import("../lib/note-attachments"),
  import("../lib/note-archive"),
  import("../app/api/notes/export/route"),
  import("../app/api/notes/import/route"),
  import("../lib/mcp"),
  import("../app/api/notes/[id]/duplicate/route"),
  import("../lib/file-upload-store"),
]);
let modules: Awaited<typeof imports>;
const owner = randomUUID(), member = randomUUID(), stranger = randomUUID();
const tokens = new Map<string, string>();
let projectA: string, projectB: string;

function project(ownerId: string) {
  const id = randomUUID(), at = new Date().toISOString();
  modules[0].getDatabase().prepare("INSERT INTO projects(id,owner_id,data,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(id, ownerId, JSON.stringify({ id, ownerId, name: "Project" }), at, at);
  return id;
}
function req(url: string, ownerId = owner, body?: unknown, key?: string) {
  return new Request("http://localhost" + url, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: "ai_chat_auth=" + tokens.get(ownerId), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function params(id: string) { return { params: Promise.resolve({ id }) }; }

before(async () => {
  modules = await imports;
  const db = modules[0].getDatabase();
  for (const id of [owner, member, stranger]) {
    const token = randomUUID(); tokens.set(id, token);
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 600_000).toISOString());
  }
  projectA = project(owner); projectB = project(owner);
  db.prepare("INSERT INTO project_members(project_id,user_id,created_at) VALUES(?,?,?)").run(projectA, member, new Date().toISOString());
});
after(async () => { await rm(dataDir, { recursive: true, force: true }); });



test("duplicate API copies only the selected readable subtree with independent attachments and internal links", async () => {
  const notes = modules[1], db = modules[0].getDatabase(), uploads = modules[13];
  const sourceProject = project(owner);
  db.prepare("INSERT INTO project_members(project_id,user_id,created_at) VALUES(?,?,?)").run(sourceProject, member, new Date().toISOString());
  const host = notes.createNote({ ownerId: owner, projectId: sourceProject, title: "Host" });
  const targetParent = notes.createNote({ ownerId: member, projectId: sourceProject, title: "Destination" });
  const root = notes.createNote({ ownerId: owner, parentId: host.id, title: "Original.md", icon: "📁", cover: "#fffdfa", fullWidth: true, favorite: true, todos: [{ id: "todo", content: "Keep task", status: "pending" }] });
  const upload = uploads.createUpload(owner, { name: "pixel.png", mimeType: "image/png", size: 4 });
  await uploads.appendUpload(owner, upload.id, 0, new Response(new Uint8Array([137, 80, 78, 71])).body);
  uploads.completeUpload(owner, upload.id);
  const assetContent = JSON.stringify({ name: "pixel.png", caption: "source metadata" });
  const child = notes.createNote({ ownerId: owner, parentId: root.id, title: "Image", kind: "image", uploadId: upload.id, content: assetContent, sortKey: 55 });
  const [attachment] = await modules[7].storeNoteFiles(child.id, [new File(["independent text"], "report.txt")], owner);
  notes.createNote({ ownerId: owner, parentId: root.id, kind: "learned_fact", content: "never copy private learned facts" });
  const source = notes.updateNote(root.id, { ownerId: owner, content: "\n[Child](note://" + child.id + "#block)\n[Report](" + attachment.url + ")\n" })!;
  const response = await modules[12].POST(req("/api/notes/" + root.id + "/duplicate", member, { version: source.version, parentId: targetParent.id }, "duplicate-subtree"), params(root.id));
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json() as { rootId: string; notes: import("../lib/store").SharedNote[] };
  assert.equal(body.notes.length, 2);
  const copy = body.notes.find(note => note.id === body.rootId)!, copiedChild = body.notes.find(note => note.title === child.title)!;
  assert.equal(copy.title, "Original (copy).md"); assert.equal(copy.parentId, targetParent.id);
  assert.equal(copy.icon, root.icon); assert.equal(copy.cover, root.cover); assert.equal(copy.fullWidth, true); assert.equal(copy.favorite, true);
  assert.deepEqual(copy.todos, root.todos);
  assert.ok(body.notes.every(note => note.ownerId === member && note.projectId === sourceProject));
  assert.equal(copiedChild.parentId, copy.id); assert.equal(copiedChild.sortKey, 55);
  assert.ok(copy.content.includes("note://" + copiedChild.id + "#block"));
  assert.ok(!copy.content.includes(attachment.url));
  const copiedReportId = copy.content.match(/\/attachments\/([a-f0-9-]+)/)![1];
  assert.ok(copy.content.includes("/api/notes/" + copiedChild.id + "/attachments/"));
  assert.equal((await modules[7].readNoteFile(copiedChild.id, copiedReportId, member))?.data.toString(), "independent text");
  assert.equal(copiedChild.kind, "note");
  assert.ok(copiedChild.content.startsWith(assetContent)); assert.ok(copiedChild.content.includes("![pixel.png]("));
  const copiedImageId = copiedChild.content.match(/\/attachments\/([a-f0-9-]+)/)![1];
  assert.deepEqual((await modules[7].readNoteFile(copiedChild.id, copiedImageId, member))?.data, Buffer.from([137, 80, 78, 71]));
  assert.equal(notes.getNote(root.id, owner)?.parentId, host.id); assert.equal(notes.getNote(child.id, owner)?.kind, "image");
  const retry = await modules[12].POST(req("/api/notes/" + root.id + "/duplicate", member, { version: source.version, parentId: targetParent.id }, "duplicate-subtree"), params(root.id));
  assert.equal((await retry.json()).rootId, copy.id);
  notes.deleteNote(root.id, owner); notes.deleteNote(child.id, owner);
  await uploads.deleteUpload(owner, upload.id);
  assert.equal((await modules[7].readNoteFile(copiedChild.id, copiedReportId, member))?.data.toString(), "independent text");
  assert.deepEqual((await modules[7].readNoteFile(copiedChild.id, copiedImageId, member))?.data, Buffer.from([137, 80, 78, 71]));
});

test("rich page references, nested links and block anchors follow ZIP import and duplicate IDs", async () => {
  const notes = modules[1], archives = modules[8], sourceProject = project(owner), targetProject = project(owner);
  const root = notes.createNote({ ownerId: owner, projectId: sourceProject, title: "Rich root" });
  const child = notes.createNote({ ownerId: owner, parentId: root.id, title: "Rich child", content: "Target\n\n<!-- metis:block:stable-anchor -->" });
  const [attachment] = await modules[7].storeNoteFiles(child.id, [new File(["rich bytes"], "rich.txt")], owner);
  const rich = {
    type: "columns", attrs: { blockId: "columns-anchor" }, content: [{ type: "column", content: [
      { type: "pageReference", attrs: { noteId: child.id, title: "Child", blockId: "reference-anchor" } },
      { type: "paragraph", content: [{ type: "text", text: "Jump", marks: [{ type: "link", attrs: { href: "metis://note/" + child.id + "#block-stable-anchor" } }] }] },
      { type: "embedBlock", attrs: { url: attachment.url, title: "Copied file" } },
    ] }],
  };
  const unknown = "\n\n~~~metis-block\n" + JSON.stringify({ type: "futureNode", attrs: { noteId: child.id, href: "metis://note/" + child.id + "#block-stable-anchor" } }) + "\n~~~";
  const embeddedFile = "\n\n~~~file\n" + JSON.stringify({ url: attachment.url, name: "rich.txt", mimeType: "text/plain", custom: "preserve extra metadata" }) + "\n~~~";
  notes.updateNote(root.id, { ownerId: owner, content: "[Block](metis://note/" + child.id + "#block-stable-anchor)\n\n~~~metis-block\n" + JSON.stringify(rich, null, 2) + "\n~~~" + unknown + embeddedFile });
  const archive = await archives.exportNoteArchive({ ownerId: owner, projectId: sourceProject });
  const imported = await archives.importNoteArchive({ ownerId: owner, projectId: targetProject, file: new File([new Uint8Array(archive)], "rich.zip") });
  const importedRoot = imported.notes.find(note => note.title === root.title)!, importedChild = imported.notes.find(note => note.title === child.title)!;
  assert.ok(importedRoot.content.includes('"noteId":"' + importedChild.id + '"'));
  assert.ok(importedRoot.content.includes("note://" + importedChild.id + "#block-stable-anchor"));
  assert.ok(importedRoot.content.includes('"blockId":"reference-anchor"'));
  assert.ok(importedRoot.content.includes("/api/notes/" + importedChild.id + "/attachments/"));
  assert.ok(importedRoot.content.includes(unknown));
  assert.ok(importedRoot.content.includes('"custom":"preserve extra metadata"'));
  assert.ok(!importedRoot.content.includes('"url":"' + attachment.url + '"'));
  assert.equal(importedChild.content, child.content);
  const duplicated = await archives.duplicateNoteSubtree({ ownerId: owner, id: root.id });
  const duplicateRoot = duplicated!.notes.find(note => note.id === duplicated!.rootId)!, duplicateChild = duplicated!.notes.find(note => note.title === child.title)!;
  assert.ok(duplicateRoot.content.includes('"noteId":"' + duplicateChild.id + '"'));
  assert.ok(duplicateRoot.content.includes("note://" + duplicateChild.id + "#block-stable-anchor"));
  assert.ok(duplicateRoot.content.includes("/api/notes/" + duplicateChild.id + "/attachments/"));
  assert.ok(duplicateRoot.content.includes(unknown));
});

test("duplicate checks ACLs, versions, target container and concurrent source changes without partial copies", async () => {
  const notes = modules[1], archives = modules[8], sourceProject = project(owner);
  const root = notes.createNote({ ownerId: owner, projectId: sourceProject, title: "Protected" });
  const count = () => notes.listNotes({ ownerId: owner, projectId: sourceProject, includeArchived: true }).length;
  assert.equal((await modules[12].POST(new Request("http://localhost"), params(root.id))).status, 401);
  assert.equal((await modules[12].POST(req("/api/notes/" + root.id + "/duplicate", stranger, {}), params(root.id))).status, 404);
  assert.equal((await modules[12].POST(req("/api/notes/" + root.id + "/duplicate", owner, { version: 99 }), params(root.id))).status, 409);
  const otherParent = notes.createNote({ ownerId: owner });
  assert.equal((await modules[12].POST(req("/api/notes/" + root.id + "/duplicate", owner, { parentId: otherParent.id }), params(root.id))).status, 400);
  const pending = archives.duplicateNoteSubtree({ id: root.id, ownerId: owner, expectedVersion: 1 });
  notes.updateNote(root.id, { ownerId: owner, content: "concurrent edit" });
  await assert.rejects(() => pending, notes.NoteConflictError);
  assert.equal(count(), 1);
  const missing = notes.updateNote(root.id, { ownerId: owner, content: "[missing](/api/notes/" + root.id + "/attachments/" + randomUUID() + ")" })!;
  const rejected = await modules[12].POST(req("/api/notes/" + root.id + "/duplicate", owner, { version: missing.version }), params(root.id));
  assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /unavailable referenced attachment/);
  assert.equal(count(), 1);
});

test("relative sibling moves rebalance tied legacy keys transactionally and retain idempotency and ACLs", async () => {
  const notes = modules[1], sourceProject = project(owner);
  const parent = notes.createNote({ ownerId: owner, projectId: sourceProject });
  for (let index = 0; index < 3; index++) notes.createNote({ ownerId: owner, parentId: parent.id, title: "Legacy " + index, sortKey: 0 });
  const mover = notes.createNote({ ownerId: owner, parentId: parent.id, title: "Mover", sortKey: 1024 });
  const siblings = () => notes.listNotes({ ownerId: owner, projectId: sourceProject, parentId: parent.id });
  const [first, second, third] = siblings();
  const original = siblings().map(note => ({ id: note.id, version: note.version, sortKey: note.sortKey }));
  const db = modules[0].getDatabase();
  db.exec("CREATE TEMP TRIGGER reject_reorder BEFORE UPDATE ON notes WHEN NEW.id='" + mover.id + "' BEGIN SELECT RAISE(ABORT,'fixture reorder failure'); END");
  try {
    assert.throws(() => notes.moveNote(mover.id, { ownerId: owner, afterId: first.id, expectedVersion: 1 }), /fixture reorder failure/);
    assert.deepEqual(siblings().map(note => ({ id: note.id, version: note.version, sortKey: note.sortKey })), original);
  } finally { db.exec("DROP TRIGGER reject_reorder"); }
  const response = await modules[4].POST(req("/api/notes/" + mover.id + "/move", owner, { afterId: first.id, version: mover.version }, "reorder-ties"), params(mover.id));
  assert.equal(response.status, 200);
  const moved = (await response.json()).note;
  assert.deepEqual(siblings().map(note => note.id), [first.id, mover.id, second.id, third.id]);
  assert.equal(new Set(siblings().map(note => note.sortKey)).size, 4);
  const snapshot = siblings().map(note => ({ id: note.id, version: note.version, sortKey: note.sortKey }));
  const retry = await modules[4].POST(req("/api/notes/" + mover.id + "/move", owner, { afterId: first.id, version: mover.version }, "reorder-ties"), params(mover.id));
  assert.equal(retry.status, 200); assert.equal((await retry.json()).note.version, moved.version);
  assert.deepEqual(siblings().map(note => ({ id: note.id, version: note.version, sortKey: note.sortKey })), snapshot);
  assert.equal((await modules[4].POST(req("/api/notes/" + mover.id + "/move", owner, { beforeId: first.id, version: 1 }), params(mover.id))).status, 409);
  const otherParent = notes.createNote({ ownerId: owner, projectId: sourceProject });
  const otherChild = notes.createNote({ ownerId: owner, parentId: otherParent.id });
  assert.throws(() => notes.moveNote(mover.id, { ownerId: owner, beforeId: otherChild.id }), /anchor must be a sibling/);
  assert.throws(() => notes.moveNote(mover.id, { ownerId: owner, beforeId: first.id, afterId: second.id }), /not both/);
  assert.equal(notes.moveNote(mover.id, { ownerId: stranger, beforeId: first.id }), null);
  notes.moveNote(mover.id, { ownerId: owner, beforeId: first.id, expectedVersion: moved.version });
  assert.deepEqual(siblings().map(note => note.id), [mover.id, first.id, second.id, third.id]);
  notes.moveNote(mover.id, { ownerId: owner, afterId: third.id });
  assert.deepEqual(siblings().map(note => note.id), [first.id, second.id, third.id, mover.id]);
  assert.equal(notes.getNote(otherChild.id, owner)?.version, 1);
});

test("project deletion preserves creators' private trees, versions, attachments, pins and learned facts", async () => {
  const notes = modules[1], db = modules[0].getDatabase(), deletedProject = project(owner);
  db.prepare("INSERT INTO project_members(project_id,user_id,created_at) VALUES(?,?,?)").run(deletedProject, member, new Date().toISOString());
  const root = notes.createNote({ ownerId: owner, projectId: deletedProject, title: "Owner root" });
  const memberRoot = notes.createNote({ ownerId: member, parentId: root.id, title: "Member child" });
  const memberChild = notes.createNote({ ownerId: member, parentId: memberRoot.id, title: "Member grandchild" });
  const ownerChild = notes.createNote({ ownerId: owner, parentId: memberRoot.id, title: "Owner descendant" });
  const fact = notes.createNote({ ownerId: owner, projectId: deletedProject, kind: "learned_fact", content: "Private memory" });
  const [attachment] = await modules[7].storeNoteFiles(memberRoot.id, [new File(["kept on delete"], "saved.txt")], member);
  const chat = modules[6].createChat("Preserved pins", undefined, owner);
  modules[6].updateChat(chat.id, { sessionState: { pinnedNoteIds: [root.id, memberRoot.id] } }, owner);
  // The DB trigger also covers deletes issued by an older app or another worker.
  db.prepare("DELETE FROM projects WHERE id=?").run(deletedProject);
  assert.equal(notes.getNote(root.id, owner)?.projectId, undefined);
  assert.equal(notes.getNote(memberRoot.id, member)?.projectId, undefined);
  assert.equal(notes.getNote(memberRoot.id, member)?.parentId, null);
  assert.equal(notes.getNote(memberChild.id, member)?.parentId, memberRoot.id);
  assert.equal(notes.getNote(ownerChild.id, owner)?.parentId, null);
  assert.equal(notes.getNote(root.id, owner)?.version, 2);
  assert.equal(notes.getNote(memberRoot.id, owner), null); assert.equal(notes.getNote(root.id, member), null);
  assert.ok(notes.listNotes({ ownerId: member, projectId: null }).some(note => note.id === memberChild.id));
  assert.equal((await modules[7].readNoteFile(memberRoot.id, attachment.id, member))?.data.toString(), "kept on delete");
  assert.deepEqual(modules[6].getChat(chat.id, owner)?.sessionState?.pinnedNoteIds, [root.id, memberRoot.id]);
  assert.equal(notes.getNote(fact.id, owner)?.kind, "learned_fact");
  assert.equal(notes.getNote(fact.id, owner)?.content, "Private memory");
});

test("chat rewinds preserve workspace tree moves and promote surviving children of removed chat notes", async () => {
  const notes = modules[1], chat = modules[6].createChat("Rewind hierarchy", undefined, owner);
  const root = notes.createNote({ ownerId: owner, projectId: projectA });
  const child = notes.createNote({ ownerId: owner, parentId: root.id, chatId: chat.id, scope: "chat", content: "before" });
  await new Promise(resolve => setTimeout(resolve, 5));
  const cutoff = new Date().toISOString();
  await new Promise(resolve => setTimeout(resolve, 5));
  notes.updateNote(child.id, { ownerId: owner, content: "after" });
  notes.moveNote(root.id, { ownerId: owner, projectId: projectB });
  notes.updateNote(root.id, { ownerId: owner, archived: true });
  const transient = notes.createNote({ ownerId: owner, chatId: chat.id, scope: "chat" });
  const survivor = notes.createNote({ ownerId: owner, parentId: transient.id, scope: "global" });
  notes.revertChatNotes(chat.id, owner, cutoff);
  const restored = notes.getNote(child.id, owner)!;
  assert.equal(restored.content, "before");
  assert.equal(restored.parentId, root.id); assert.equal(restored.projectId, projectB); assert.equal(restored.archived, true);
  assert.equal(notes.getNote(transient.id, owner), null);
  assert.equal(notes.getNote(survivor.id, owner)?.parentId, null);
});

test("archive and restore propagate to descendants and failed subtree writes roll back", () => {
  const notes = modules[1], db = modules[0].getDatabase();
  const root = notes.createNote({ ownerId: owner, projectId: projectA }), child = notes.createNote({ ownerId: owner, parentId: root.id }), leaf = notes.createNote({ ownerId: owner, parentId: child.id });
  notes.updateNote(root.id, { ownerId: owner, archived: true, expectedVersion: 1 });
  assert.ok([root, child, leaf].every(n => notes.getNote(n.id, owner)?.archived));
  notes.updateNote(root.id, { ownerId: owner, archived: false, expectedVersion: 2 });
  assert.ok([root, child, leaf].every(n => !notes.getNote(n.id, owner)?.archived));
  db.exec("CREATE TEMP TRIGGER reject_subtree BEFORE UPDATE ON notes WHEN NEW.id='" + leaf.id + "' BEGIN SELECT RAISE(ABORT,'fixture subtree write failure'); END");
  try {
    assert.throws(() => notes.moveNote(root.id, { ownerId: owner, projectId: projectB }), /fixture subtree/);
    assert.ok([root, child, leaf].every(n => notes.getNote(n.id, owner)?.projectId === projectA));
    assert.ok([root, child, leaf].every(n => notes.getNote(n.id, owner)?.version === 3));
  } finally { db.exec("DROP TRIGGER reject_subtree"); }
});

test("ZIP round trips preserve hierarchy, page metadata, Markdown links and attachment bytes with new IDs", async () => {
  const notes = modules[1], archives = modules[8];
  const sourceProject = project(owner), targetProject = project(owner);
  const root = notes.createNote({ ownerId: owner, projectId: sourceProject, title: "Export root # one", icon: "📁", cover: "#fafafa", favorite: true, fullWidth: true });
  const child = notes.createNote({ ownerId: owner, parentId: root.id, title: "Export child", sortKey: 99 });
  const [attachment] = await modules[7].storeNoteFiles(child.id, [new File(["saved attachment bytes"], "report one.txt")], owner);
  notes.updateNote(root.id, { ownerId: owner, content: " \n[Child](note://" + child.id + ")\n\n  trailing  \n" });
  notes.updateNote(child.id, { ownerId: owner, content: "\n    code\n\n[Report](" + attachment.url + ")\n[Root](note://" + root.id + ")\n" });
  const fact = notes.createNote({ ownerId: owner, projectId: sourceProject, kind: "learned_fact", content: "private learning" });
  const bytes = await archives.exportNoteArchive({ ownerId: owner, projectId: sourceProject });
  const files = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(files[".metis/pages.json"]));
  assert.equal(manifest.pages.length, 2);
  assert.ok(!JSON.stringify(manifest).includes(fact.id));
  const rootMetadata = manifest.pages.find((n: { id: string }) => n.id === root.id);
  const childMetadata = manifest.pages.find((n: { id: string }) => n.id === child.id);
  assert.ok(childMetadata.path.startsWith(rootMetadata.path.slice(0, -3) + "/"));
  assert.ok(!new TextDecoder().decode(files[childMetadata.path]).includes("/api/notes/"));
  assert.ok(new TextDecoder().decode(files[rootMetadata.path]).includes("Export%20root") || new TextDecoder().decode(files[rootMetadata.path]).includes("Export%20child"));
  const imported = await archives.importNoteArchive({ ownerId: owner, projectId: targetProject, file: new File([new Uint8Array(bytes)], "pages.zip"), idempotencyKey: "round-trip" });
  assert.equal(imported.notes.length, 2); assert.equal(imported.rootIds.length, 1);
  const newRoot = imported.notes.find(n => n.title === root.title)!, newChild = imported.notes.find(n => n.title === child.title)!;
  assert.notEqual(newRoot.id, root.id); assert.notEqual(newChild.id, child.id);
  assert.equal(newRoot.projectId, targetProject); assert.equal(newRoot.parentId, null);
  assert.equal(newChild.parentId, newRoot.id); assert.equal(newChild.sortKey, 99);
  assert.equal(newRoot.icon, "📁"); assert.equal(newRoot.cover, "#fafafa"); assert.equal(newRoot.fullWidth, true); assert.equal(newRoot.favorite, true);
  assert.equal(newRoot.content, " \n[Child](note://" + newChild.id + ")\n\n  trailing  \n");
  assert.ok(newChild.content.startsWith("\n    code\n\n")); assert.ok(newChild.content.endsWith("[Root](note://" + newRoot.id + ")\n"));
  const attachmentId = newChild.content.match(/\/attachments\/([a-f0-9-]+)/)![1];
  assert.notEqual(attachmentId, attachment.id);
  assert.equal((await modules[7].readNoteFile(newChild.id, attachmentId, owner))?.data.toString(), "saved attachment bytes");
  assert.equal(notes.getNote(root.id, owner)?.projectId, sourceProject);
  const retry = await archives.importNoteArchive({ ownerId: owner, projectId: targetProject, file: new File([new Uint8Array(bytes)], "pages.zip"), idempotencyKey: "round-trip" });
  assert.deepEqual(retry.rootIds, imported.rootIds);
  assert.equal(notes.listNotes({ ownerId: owner, projectId: targetProject }).length, 2);
  const invisible = unzipSync(await archives.exportNoteArchive({ ownerId: stranger, projectId: sourceProject }));
  assert.equal(JSON.parse(new TextDecoder().decode(invisible[".metis/pages.json"])).pages.length, 0);
});

test("Markdown and ordinary ZIP imports retain text and derive folders and local links", async () => {
  const archives = modules[8];
  const target = project(owner);
  const single = await archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File(["\n    verbatim\n\n  end  \n"], "Single.md") });
  assert.equal(single.notes[0].content, "\n    verbatim\n\n  end  \n");
  const bytes = zipSync({
    "Folder/index.md": strToU8("# Parent\n"),
    "Folder/Child.md": strToU8("[Parent](index.md)\n[File](image.bin)\n"),
    "Folder/image.bin": new Uint8Array([0, 1, 2, 255]),
    "Implicit/Nested.md": strToU8("nested"),
  });
  const imported = await archives.importNoteArchive({ ownerId: owner, projectId: target, parentId: single.rootIds[0], file: new File([bytes], "ordinary.zip") });
  assert.equal(imported.notes.length, 4);
  const folder = imported.notes.find(n => n.title === "Folder")!, child = imported.notes.find(n => n.title === "Child")!;
  assert.equal(folder.parentId, single.rootIds[0]); assert.equal(child.parentId, folder.id);
  assert.ok(child.content.includes("note://" + folder.id));
  const attachmentId = child.content.match(/\/attachments\/([a-f0-9-]+)/)![1];
  assert.deepEqual((await modules[7].readNoteFile(child.id, attachmentId, owner))?.data, Buffer.from([0, 1, 2, 255]));
  const implicit = imported.notes.find(n => n.title === "Implicit")!;
  assert.equal(imported.notes.find(n => n.title === "Nested")?.parentId, implicit.id);
  assert.equal(implicit.content, "");
});

test("archive imports reject unsafe paths, expanded limits, malformed trees and oversize text without writes", async () => {
  const archives = modules[8], notes = modules[1], target = project(owner);
  const count = () => notes.listNotes({ ownerId: owner, projectId: target, includeArchived: true }).length;
  const badPath = zipSync({ "../outside.md": strToU8("outside") });
  await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File([badPath], "bad.zip") }), /unsafe file path/);
  const oversized = zipSync({ "x.md": strToU8("x") });
  for (let offset = 0; offset < oversized.length - 28; offset++) {
    const view = new DataView(oversized.buffer);
    if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 24, 100 * 1024 * 1024 + 1, true); break; }
  }
  await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File([oversized], "large.zip") }), /100 MiB expanded/);
  const metadata = { format: "metis-pages", formatVersion: 1, pages: [
    { id: "a", parentId: "b", path: "a.md", title: "A" },
    { id: "b", parentId: "a", path: "b.md", title: "B" },
  ] };
  const cyclic = zipSync({ "a.md": strToU8("a"), "b.md": strToU8("b"), ".metis/pages.json": strToU8(JSON.stringify(metadata)) });
  await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File([cyclic], "cyclic.zip") }), /cycle/);
  const repeatedPages = Array.from({ length: 400 }, (_, index) => ({
    id: "p" + index, path: "p" + index + ".md", title: "P" + index,
    attachments: [{ id: "shared", path: "asset.bin", name: "asset.bin", mimeType: "application/octet-stream", kind: "file" }],
  }));
  const repeatedFiles: Record<string, Uint8Array> = { "asset.bin": new Uint8Array(300_000), ".metis/pages.json": strToU8(JSON.stringify({ format: "metis-pages", formatVersion: 1, pages: repeatedPages })) };
  for (const page of repeatedPages) repeatedFiles[page.path] = strToU8("body");
  await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File([zipSync(repeatedFiles)], "references.zip") }), /Imported attachments exceed/);
  const deepPages = Array.from({ length: 101 }, (_, index) => ({ id: "d" + index, parentId: index ? "d" + (index - 1) : null, path: "d" + index + ".md", title: "D" + index }));
  const deepFiles: Record<string, Uint8Array> = { ".metis/pages.json": strToU8(JSON.stringify({ format: "metis-pages", formatVersion: 1, pages: deepPages })) };
  for (const page of deepPages) deepFiles[page.path] = strToU8("body");
  await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File([zipSync(deepFiles)], "deep.zip") }), /100 levels/);
  await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File(["x".repeat(50_001)], "large.md") }), /50,000 character/);
  await assert.rejects(() => archives.importNoteArchive({ ownerId: stranger, projectId: target, file: new File(["x"], "private.md") }), /not found/);
  assert.equal(count(), 0);
});

test("late import failure rolls back note rows and adopted attachments", async () => {
  const archives = modules[8], db = modules[0].getDatabase(), target = project(owner);
  const base = path.join(modules[11].getAgentCwd(owner), ".note-attachments");
  const beforeNames = (await readdir(base)).sort();
  const metadata = { format: "metis-pages", formatVersion: 1, pages: [{
    id: "source", parentId: null, path: "source.md", title: "Rollback",
    attachments: [{ id: "old", path: "assets/a.bin", name: "a.bin", mimeType: "application/octet-stream", kind: "file" }],
  }] };
  const bytes = zipSync({ "source.md": strToU8("[file](assets/a.bin)"), "assets/a.bin": new Uint8Array([4, 2]), ".metis/pages.json": strToU8(JSON.stringify(metadata)) });
  db.exec("CREATE TEMP TRIGGER reject_import_key BEFORE INSERT ON idempotency_keys WHEN NEW.key='fail-import' BEGIN SELECT RAISE(ABORT,'fixture import failure'); END");
  try {
    await assert.rejects(() => archives.importNoteArchive({ ownerId: owner, projectId: target, file: new File([bytes], "rollback.zip"), idempotencyKey: "fail-import" }), /fixture import failure/);
    assert.equal(modules[1].listNotes({ ownerId: owner, projectId: target }).length, 0);
    assert.deepEqual((await readdir(base)).sort(), beforeNames);
  } finally { db.exec("DROP TRIGGER reject_import_key"); }
});

test("HTTP archive endpoints authenticate and import one multipart file into the selected container", async () => {
  const target = project(owner);
  assert.equal((await modules[9].GET(new Request("http://localhost/api/notes/export"))).status, 401);
  assert.equal((await modules[10].POST(new Request("http://localhost/api/notes/import"))).status, 401);
  const form = new FormData();
  form.set("file", new File(["\nexact markdown\n"], "HTTP.md"));
  form.set("projectId", target);
  const imported = await modules[10].POST(new Request("http://localhost/api/notes/import", { method: "POST", headers: { cookie: "ai_chat_auth=" + tokens.get(owner) }, body: form }));
  assert.equal(imported.status, 201, await imported.clone().text());
  const body = await imported.json();
  assert.equal(body.notes.length, 1); assert.equal(body.notes[0].projectId, target); assert.equal(body.notes[0].content, "\nexact markdown\n");
  const download = await modules[9].GET(req("/api/notes/export?projectId=" + target));
  assert.equal(download.status, 200); assert.equal(download.headers.get("content-type"), "application/zip");
  assert.ok(unzipSync(new Uint8Array(await download.arrayBuffer()))[".metis/pages.json"]);
  const invalid = new FormData(); invalid.set("file", new File(["data"], "file.txt"));
  assert.equal((await modules[10].POST(new Request("http://localhost/api/notes/import", { method: "POST", headers: { cookie: "ai_chat_auth=" + tokens.get(owner) }, body: invalid }))).status, 400);
});

test("legacy notes become root Markdown pages without clipping or assigning a project", () => {
  const { getDatabase } = modules[0], notes = modules[1];
  const at = new Date().toISOString(), id = randomUUID();
  const content = "  indented\n\n" + "x".repeat(50_010) + "\n  ";
  const legacy = { id, ownerId: owner, title: "Legacy", content, scope: "global", kind: "note", color: "#fef08a", position: { x: 0, y: 0 }, size: { width: 280, height: 220 }, author: "user", archived: false, version: 7, createdAt: at, updatedAt: at };
  getDatabase().prepare("INSERT INTO notes(id,owner_id,scope,data,version,archived,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)").run(id, owner, "global", JSON.stringify(legacy), 7, at, at);
  const page = notes.getNote(id, owner)!;
  assert.equal(page.parentId, null); assert.equal(page.projectId, undefined);
  assert.equal(page.sortKey, 0); assert.equal(page.formatVersion, 1);
  assert.equal(page.fullWidth, false); assert.equal(page.favorite, false);
  assert.equal(page.content, content); assert.equal(page.version, 7);
  assert.equal(notes.updateNote(id, { ownerId: owner, favorite: true })?.content, content);
  const created = notes.createNote({ ownerId: owner, content: "  code\n\n    nested\n" });
  assert.equal(created.projectId, undefined); assert.equal(created.parentId, null);
  assert.equal(created.content, "  code\n\n    nested\n");
});

test("nesting infers the parent container, preserves metadata, and orders siblings", () => {
  const notes = modules[1];
  const root = notes.createNote({ ownerId: owner, projectId: projectA, title: "Root" });
  const first = notes.createNote({ ownerId: owner, parentId: root.id, title: "First", icon: "📄", cover: "#e7e5e4", fullWidth: true, favorite: true });
  const second = notes.createNote({ ownerId: member, parentId: root.id, title: "Second" });
  assert.equal(first.projectId, projectA); assert.equal(second.projectId, projectA);
  assert.ok(first.sortKey! < second.sortKey!);
  notes.updateNote(second.id, { ownerId: member, sortKey: first.sortKey! - 1 });
  assert.deepEqual(notes.listNotes({ ownerId: owner, parentId: root.id }).map(n => n.id), [second.id, first.id]);
  const listed = notes.listNotes({ ownerId: member, projectId: projectA }).find(n => n.id === root.id)!;
  assert.equal(listed.childCount, 2); assert.equal(listed.hasChildren, true);
  assert.equal(notes.getNote(first.id, owner)?.icon, "📄");
  assert.equal(notes.getNote(first.id, owner)?.fullWidth, true);
  assert.throws(() => notes.createNote({ ownerId: owner, parentId: root.id, projectId: projectB }), /same project/);
  assert.throws(() => notes.createNote({ ownerId: stranger, parentId: root.id }), /not found/);
  assert.throws(() => notes.createNote({ ownerId: stranger, parentId: notes.createNote({ ownerId: owner }).id }), /not found/);
});

test("self and descendant cycles fail without changing the tree or versions", () => {
  const notes = modules[1];
  const root = notes.createNote({ ownerId: owner }), child = notes.createNote({ ownerId: owner, parentId: root.id }), grandchild = notes.createNote({ ownerId: owner, parentId: child.id });
  assert.throws(() => notes.moveNote(root.id, { ownerId: owner, parentId: root.id }), /own parent/);
  assert.throws(() => notes.updateNote(root.id, { ownerId: owner, parentId: grandchild.id, content: "must not save" }), /descendants/);
  assert.equal(notes.getNote(root.id, owner)?.version, 1);
  assert.equal(notes.getNote(root.id, owner)?.content, "");
  assert.equal(notes.getNote(child.id, owner)?.parentId, root.id);
});

test("cross-container moves update all descendants atomically and preserve IDs, attachments, pins, kinds and scopes", async () => {
  const notes = modules[1], db = modules[0].getDatabase();
  const chat = modules[6].createChat("Pinned tree", undefined, owner);
  const root = notes.createNote({ ownerId: owner, projectId: projectA, title: "Move me", favorite: true });
  const child = notes.createNote({ ownerId: owner, parentId: root.id, scope: "chat", chatId: chat.id, content: "\n    markdown\n" });
  const leaf = notes.createNote({ ownerId: owner, parentId: child.id, kind: "learned_fact", archived: true, workspaceId: "workspace-1", scope: "workspace" });
  const [attachment] = await modules[7].storeNoteFiles(child.id, [new File(["exact bytes"], "saved.txt")], owner);
  modules[6].updateChat(chat.id, { sessionState: { pinnedNoteIds: [root.id, child.id] } }, owner);
  const destination = notes.createNote({ ownerId: owner, projectId: projectB });
  const moved = notes.moveNote(root.id, { ownerId: owner, parentId: destination.id, expectedVersion: 1, idempotencyKey: "move-tree" })!;
  assert.equal(moved.id, root.id); assert.equal(moved.projectId, projectB); assert.equal(moved.favorite, true);
  assert.equal(notes.getNote(child.id, owner)?.projectId, projectB);
  assert.equal(notes.getNote(child.id, owner)?.parentId, root.id);
  assert.equal(notes.getNote(child.id, owner)?.scope, "chat");
  assert.equal(notes.getNote(child.id, owner)?.chatId, chat.id);
  assert.equal(notes.getNote(child.id, owner)?.content, "\n    markdown\n");
  assert.equal(notes.getNote(leaf.id, owner)?.projectId, projectB);
  assert.equal(notes.getNote(leaf.id, owner)?.kind, "learned_fact");
  assert.equal(notes.getNote(leaf.id, owner)?.archived, true);
  assert.equal(notes.getNote(leaf.id, owner)?.scope, "workspace");
  assert.equal(notes.getNote(leaf.id, owner)?.workspaceId, "workspace-1");
  assert.equal((await modules[7].readNoteFile(child.id, attachment.id, owner))?.data.toString(), "exact bytes");
  assert.deepEqual(modules[6].getChat(chat.id, owner)?.sessionState?.pinnedNoteIds, [root.id, child.id]);
  assert.equal(notes.moveNote(root.id, { ownerId: owner, parentId: destination.id, expectedVersion: 1, idempotencyKey: "move-tree" })?.version, moved.version);
  notes.moveNote(root.id, { ownerId: owner, projectId: null, parentId: null, expectedVersion: moved.version });
  assert.equal(notes.getNote(child.id, owner)?.projectId, undefined);
  assert.equal(notes.getNote(leaf.id, owner)?.projectId, undefined);
  assert.equal(notes.getNote(child.id, stranger), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notes WHERE id IN (?,?,?)").get(root.id, child.id, leaf.id)?.count, 3);
});

test("cross-project moves reject foreign-owned descendants and destination ACLs before committing", () => {
  const notes = modules[1];
  const root = notes.createNote({ ownerId: owner, projectId: projectA });
  const foreignChild = notes.createNote({ ownerId: member, parentId: root.id });
  assert.throws(() => notes.moveNote(root.id, { ownerId: owner, projectId: projectB }), /creator/);
  assert.equal(notes.getNote(root.id, owner)?.projectId, projectA);
  assert.equal(notes.getNote(foreignChild.id, owner)?.projectId, projectA);
  assert.equal(notes.getNote(foreignChild.id, owner)?.version, 1);
  assert.throws(() => notes.moveNote(foreignChild.id, { ownerId: member, projectId: projectB }), /not found/);
  assert.throws(() => notes.updateNote(foreignChild.id, { ownerId: member, expectedVersion: 99, favorite: true }), notes.NoteConflictError);
  const privateParent = notes.createNote({ ownerId: owner });
  assert.throws(() => notes.moveNote(foreignChild.id, { ownerId: member, parentId: privateParent.id }), /not found/);
});

test("single-page deletion promotes children to the surviving parent", () => {
  const notes = modules[1];
  const root = notes.createNote({ ownerId: owner }), child = notes.createNote({ ownerId: owner, parentId: root.id }), grandchild = notes.createNote({ ownerId: owner, parentId: child.id });
  assert.equal(notes.deleteNote(child.id, owner), true);
  assert.equal(notes.getNote(grandchild.id, owner)?.parentId, root.id);
  assert.equal(notes.getNote(grandchild.id, owner)?.version, 2);
});

test("HTTP API supports none filters, parent metadata, version conflicts, explicit size errors, and exact Markdown export", async () => {
  const [_, notes, collection, detail, move, markdown] = modules;
  const content = "\n  leading and trailing  \n\n";
  const created = await collection.POST(req("/api/notes", owner, { title: "A / title", content, projectId: null, favorite: true, fullWidth: true, parentId: null }));
  assert.equal(created.status, 201);
  const { note } = await created.json();
  assert.equal(note.parentId, null); assert.equal(note.favorite, true);
  const childResponse = await collection.POST(req("/api/notes", owner, { parentId: note.id, content: "child" }));
  assert.equal(childResponse.status, 201);
  const child = (await childResponse.json()).note;
  const listed = await collection.GET(req("/api/notes?projectId=none"));
  const list = await listed.json();
  assert.ok(list.notes.every((n: { projectId?: string }) => !n.projectId));
  assert.equal(list.notes.find((n: { id: string }) => n.id === note.id).childCount, 1);
  const roots = await (await collection.GET(req("/api/notes?projectId=none&parentId=root"))).json();
  assert.ok(roots.notes.every((n: { parentId: string | null }) => n.parentId === null));
  const moved = await move.POST(req("/api/notes/" + note.id + "/move", owner, { projectId: projectA, parentId: null, version: 1 }), params(note.id));
  assert.equal(moved.status, 200); assert.equal(notes.getNote(child.id, owner)?.projectId, projectA);
  const stale = await detail.PATCH(req("/api/notes/" + note.id, owner, { content: "stale", version: 1 }), params(note.id));
  assert.equal(stale.status, 409);
  assert.equal((await collection.POST(req("/api/notes", owner, { content: "x".repeat(50_001) }))).status, 413);
  assert.equal((await detail.PATCH(req("/api/notes/" + note.id, owner, { content: "x".repeat(50_001) }), params(note.id))).status, 413);
  assert.equal((await collection.POST(req("/api/notes", owner, { parentId: 42 }))).status, 400);
  const download = await markdown.GET(req("/api/notes/" + note.id + "/export"), params(note.id));
  assert.equal(download.status, 200); assert.equal(await download.text(), content);
  assert.match(download.headers.get("content-disposition")!, /attachment/);
  assert.equal((await markdown.GET(req("/api/notes/" + note.id + "/export", stranger), params(note.id))).status, 404);
  assert.equal((await move.POST(new Request("http://localhost"), params(note.id))).status, 401);
  const fact = notes.createNote({ ownerId: owner, kind: "learned_fact", projectId: projectA });
  assert.equal((await markdown.GET(req("/api/notes/" + fact.id + "/export"), params(fact.id))).status, 404);
  assert.ok(!(await (await collection.GET(req("/api/notes?projectId=" + projectA))).json()).notes.some((n: { id: string }) => n.id === fact.id));
});
