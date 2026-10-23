import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/sqlite";
import type { SharedNote } from "@/lib/store";
import type { Issue } from "@/lib/issue-types";

/** Keep one persisted Markdown page per issue; callers hold the same SQLite transaction. */
export function syncIssueDocument(issue: Issue) {
  if (!issue.noteId || !issue.issuebookId) return;
  const db = getDatabase();
  const row = db.prepare("SELECT data FROM notes WHERE id=?").get(issue.noteId) as {data:string}|undefined;
  if (!row) throw new Error("Issue Markdown file is missing.");
  const note = JSON.parse(row.data) as SharedNote;
  if (note.issueId && note.issueId !== issue.id) throw new Error("Issue Markdown file is already linked.");
  if ((note.projectId || null) !== issue.projectId) throw new Error("Issue Markdown file belongs to another project.");
  if (note.issueId === issue.id && note.title === issue.title && note.content === issue.description && note.parentId === issue.issuebookId) return;
  const next = {...note, issueId: issue.id, parentId: issue.issuebookId, title: issue.title, content: issue.description, version: note.version + 1, updatedAt: issue.updatedAt};
  db.prepare("UPDATE notes SET data=?,version=?,updated_at=? WHERE id=?").run(JSON.stringify(next),next.version,next.updatedAt,note.id);
  const activity = {id:randomUUID(),noteId:note.id,actor:"user",action:"updated",createdAt:next.updatedAt,before:note,after:next};
  db.prepare("INSERT INTO note_activities(id,note_id,owner_id,chat_id,data,created_at) VALUES(?,?,?,?,?,?)").run(activity.id,note.id,note.ownerId??null,note.chatId??null,JSON.stringify(activity),next.updatedAt);
}

export function syncIssueFromDocument(note: SharedNote, actorId?: string) {
  if (!note.issueId) return;
  const db = getDatabase();
  const row = db.prepare("SELECT data FROM issues WHERE id=?").get(note.issueId) as {data:string}|undefined;
  if (!row) throw new Error("The linked issue no longer exists.");
  const issue = JSON.parse(row.data) as Issue;
  const bookRow = note.parentId ? db.prepare("SELECT data FROM notes WHERE id=?").get(note.parentId) as {data:string}|undefined : undefined;
  const book = bookRow ? JSON.parse(bookRow.data) as SharedNote : undefined;
  if (issue.noteId !== note.id || issue.projectId !== (note.projectId || null) || !book || book.kind !== "issuebook" || book.archived || (book.projectId || null) !== issue.projectId) throw new Error("Keep issue files inside an active issuebook in their original project.");
  const changes:Record<string,{before:unknown;after:unknown}> = {};
  for (const [field,value] of [["title",note.title],["description",note.content],["issuebookId",book.id]] as const) {
    if (issue[field] !== value) changes[field] = {before:issue[field]??null,after:value};
  }
  if (!Object.keys(changes).length) return;
  const next = {...issue,title:note.title,description:note.content,issuebookId:book.id,version:issue.version+1,updatedAt:note.updatedAt};
  db.prepare("UPDATE issues SET data=?,updated_at=? WHERE id=?").run(JSON.stringify(next),next.updatedAt,issue.id);
  db.prepare("INSERT INTO issue_history VALUES(?,?,?,?,?,?)").run(randomUUID(),issue.id,actorId||issue.ownerId,"updated",JSON.stringify(changes),next.updatedAt);
}
