import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import { projectRole } from "@/lib/project-access";
import { createNote, deleteNote, getNote, listNotes } from "@/lib/shared-context";
import { syncIssueDocument } from "@/lib/issue-documents";
import { DEFAULT_ISSUE_FILTERS, ISSUE_PRIORITIES, ISSUE_STATUSES, type Issue, type IssueActivity, type IssueComment, type IssueDetail, type IssueFilters, type IssueMember, type IssueRelation, type IssueSource, type IssueViewSettings, type IssueWriteInput } from "@/lib/issue-types";

export class IssueError extends Error {
  constructor(message:string,public status=400) { super(message);this.name="IssueError"; }
}

/** Additive initialization: existing installations and fresh databases use the same path. */
let initialized: ReturnType<typeof getDatabase>|undefined;
export function issueDatabase() {
  const db=getDatabase();
  if(initialized===db) return db;
  return transaction(() => {
    // Older installs may contain the unused pre-project issue schema.
    // Recheck while holding the write lock so app and gateway cannot race.
    const columns = db.prepare("PRAGMA table_info(issues)").all() as Array<{ name: string }>;
    if (columns.length && !columns.some(column => column.name === "issue_key")) {
      const legacy = ["identifier", "number", "chat_id", "archived"].every(name => columns.some(column => column.name === name));
      if (!legacy) throw new Error("Unrecognized issue schema; existing data was left untouched.");
      const count = db.prepare("SELECT COUNT(*) AS count FROM issues").get() as { count: number };
      if (count.count) throw new Error("The legacy issue table contains records and needs a data migration; existing data was left untouched.");
      // Retain the complete old table and indexes, including the old constraints.
      db.exec("ALTER TABLE issues RENAME TO issues_legacy_v1");
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      issue_key TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      container_key TEXT NOT NULL,
      parent_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
      source_note_id TEXT,
      source_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issues_container_updated ON issues(container_key,updated_at DESC);
    CREATE INDEX IF NOT EXISTS issues_parent ON issues(parent_id);
    CREATE INDEX IF NOT EXISTS issues_source_note ON issues(source_note_id);
    CREATE UNIQUE INDEX IF NOT EXISTS issues_source_once ON issues(container_key,source_note_id,source_id) WHERE source_note_id IS NOT NULL AND source_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS issue_counters (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS issue_project_keys (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS issue_comments (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issue_comments_order ON issue_comments(issue_id,created_at,id);
    CREATE TABLE IF NOT EXISTS issue_history (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, action TEXT NOT NULL, changes TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issue_history_order ON issue_history(issue_id,created_at,id);
    CREATE TABLE IF NOT EXISTS issue_relations (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('related','blocks')),
      created_at TEXT NOT NULL, UNIQUE(issue_id,target_id,kind), CHECK(issue_id != target_id)
    );
    CREATE TABLE IF NOT EXISTS issue_view_settings (
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, container_key TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(owner_id,container_key)
    );
    CREATE TABLE IF NOT EXISTS issue_request_keys (
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, container_key TEXT NOT NULL, request_key TEXT NOT NULL,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE, PRIMARY KEY(owner_id,container_key,request_key)
    );
    -- Project removal preserves work, just as deleteProject preserves chats.
    -- Run before the project's FK cascade, including deletion from another process.
    CREATE TRIGGER IF NOT EXISTS issues_preserve_before_project_delete
    BEFORE DELETE ON projects
    BEGIN
      INSERT INTO issue_history(id,issue_id,actor_id,action,changes,created_at)
      SELECT lower(hex(randomblob(16))),i.id,OLD.owner_id,'project_removed',
        json_object('projectId',json_object('before',OLD.id,'after',NULL),
          'assigneeId',json_object('before',json_extract(i.data,'$.assigneeId'),
            'after',CASE WHEN json_extract(i.data,'$.assigneeId')=i.owner_id THEN i.owner_id ELSE NULL END)),
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM issues i WHERE i.project_id=OLD.id AND EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id);

      UPDATE issues SET
        -- A historical page can already have a private conversion after a move.
        -- Keep both issues and their JSON source provenance without a unique-key collision.
        source_note_id=CASE WHEN EXISTS(
          SELECT 1 FROM issues existing WHERE existing.container_key='private:'||issues.owner_id
            AND existing.source_note_id=issues.source_note_id AND existing.source_id=issues.source_id
            AND existing.id!=issues.id
        ) THEN NULL ELSE source_note_id END,
        source_id=CASE WHEN EXISTS(
          SELECT 1 FROM issues existing WHERE existing.container_key='private:'||issues.owner_id
            AND existing.source_note_id=issues.source_note_id AND existing.source_id=issues.source_id
            AND existing.id!=issues.id
        ) THEN NULL ELSE source_id END,
        project_id=NULL,container_key='private:'||owner_id,
        data=json_set(data,'$.projectId',NULL,
          '$.assigneeId',CASE WHEN json_extract(data,'$.assigneeId')=owner_id THEN owner_id ELSE NULL END,
          '$.version',COALESCE(json_extract(data,'$.version'),1)+1,
          '$.updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE project_id=OLD.id;

      UPDATE OR IGNORE issue_request_keys SET container_key='private:'||owner_id
        WHERE container_key='project:'||OLD.id AND owner_id=OLD.owner_id;
      DELETE FROM issue_request_keys WHERE container_key='project:'||OLD.id;
      DELETE FROM issue_view_settings WHERE container_key='project:'||OLD.id;
    END;
  `);
    initialized=db;
    return db;
  });
}

function userRequired(userId:string) {
  if(!userId) throw new IssueError("Unauthorized",401);
}
function scope(projectId:string|null,userId:string) {
  return projectId ? "project:"+projectId : "private:"+userId;
}
function container(userId:string,projectId:string|null) {
  userRequired(userId);
  if(projectId && !projectRole(projectId,userId)) throw new IssueError("Project not found",404);
  return scope(projectId,userId);
}
type IssueRow={data:string;parent_id:string|null;project_id:string|null;owner_id:string};
function fromRow(row:IssueRow|undefined):Issue|null {
  if(!row) return null;
  const issue=JSON.parse(row.data) as Issue;
  return {...issue,parentId:row.parent_id,projectId:row.project_id,ownerId:row.owner_id};
}
function visible(issue:Issue,userId:string) {
  return issue.projectId ? !!projectRole(issue.projectId,userId) : issue.ownerId===userId;
}
export function getIssue(id:string,userId:string):Issue|null {
  userRequired(userId);
  const issue=fromRow(issueDatabase().prepare("SELECT data,parent_id,project_id,owner_id FROM issues WHERE id=?").get(id) as IssueRow|undefined);
  return issue && visible(issue,userId) ? ensureIssueDocument(issue,userId) : null;
}
function requireIssue(id:string,userId:string) {
  const issue=getIssue(id,userId);
  if(!issue) throw new IssueError("Issue not found",404);
  return issue;
}
function issuebook(userId:string,projectId:string|null,id?:string) {
  if (id) {
    const book=getNote(id,userId);
    if (!book || book.kind!=="issuebook" || book.archived || (book.projectId||null)!==projectId) throw new IssueError("Choose an active issuebook in this project.",404);
    return book;
  }
  return listNotes({ownerId:userId,projectId}).find(note=>note.kind==="issuebook"&&!note.archived)
    || createNote({ownerId:userId,projectId,scope:"global",kind:"issuebook",title:"Issues"});
}
function ensureIssueDocument(issue:Issue,userId:string):Issue {
  if (issue.noteId && issue.issuebookId && getNote(issue.noteId,userId)) return issue;
  return transaction(()=>{
    const stored=fromRow(issueDatabase().prepare("SELECT data,parent_id,project_id,owner_id FROM issues WHERE id=?").get(issue.id) as IssueRow|undefined);
    if (!stored) throw new IssueError("Issue not found",404);
    issue=stored;
    if(stored.noteId && stored.issuebookId && getNote(stored.noteId,userId)) return {...issue,noteId:stored.noteId,issuebookId:stored.issuebookId};
    const book=issuebook(userId,issue.projectId,stored.issuebookId);
    // Seed within ordinary note limits, then copy the complete issue without truncating it.
    const note=createNote({ownerId:issue.ownerId,projectId:issue.projectId,parentId:book.id,scope:"global",title:issue.key,content:""});
    const next={...issue,issuebookId:book.id,noteId:note.id};
    issueDatabase().prepare("UPDATE issues SET data=? WHERE id=?").run(JSON.stringify(next),issue.id);
    syncIssueDocument(next);
    return next;
  });
}
function text(value:unknown,max:number,field:string,empty=true) {
  if(typeof value!=="string" || value.length>max || (!empty && !value.trim())) throw new IssueError("Invalid "+field+".");
  return value.trim();
}
function nullableId(value:unknown,field:string):string|null {
  if(value===null || value==="") return null;
  return text(value,120,field,false);
}
function normalizeSource(value:unknown,userId:string,projectId:string|null):IssueSource|null {
  if(value===null || value===undefined) return null;
  if(typeof value!=="object" || Array.isArray(value)) throw new IssueError("Invalid page source.");
  const source=value as Record<string,unknown>;
  const noteId=text(source.noteId,120,"source page",false),sourceId=text(source.sourceId,240,"source ID",false);
  if(source.kind!=="selection" && source.kind!=="checkbox") throw new IssueError("Invalid source kind.");
  const note=getNote(noteId,userId);
  if(!note || (note.projectId || null)!==projectId) throw new IssueError("Source page not found in this project.",404);
  return {noteId,sourceId,kind:source.kind,...(source.excerpt!==undefined ? {excerpt:text(source.excerpt,4000,"source excerpt")} : {})};
}
function validateAssignee(value:unknown,userId:string,projectId:string|null) {
  const id=nullableId(value,"assignee");
  if(id && (projectId ? !projectRole(projectId,id) : id!==userId)) throw new IssueError("Assignee must be a current project member.");
  return id;
}
function normalizedFields(input:IssueWriteInput,userId:string,projectId:string|null) {
  const output:Partial<Issue>={};
  if(input.title!==undefined) output.title=text(input.title,300,"title",false);
  if(input.description!==undefined) output.description=text(input.description,100_000,"description");
  if(input.status!==undefined) {
    if(!ISSUE_STATUSES.includes(input.status)) throw new IssueError("Invalid status.");
    output.status=input.status;
  }
  if(input.priority!==undefined) {
    if(!ISSUE_PRIORITIES.includes(input.priority)) throw new IssueError("Invalid priority.");
    output.priority=input.priority;
  }
  if(input.labels!==undefined) {
    if(!Array.isArray(input.labels) || input.labels.length>30) throw new IssueError("Use at most 30 labels.");
    output.labels=[...new Set(input.labels.map(label=>text(label,60,"label",false)))];
  }
  if(input.assigneeId!==undefined) output.assigneeId=validateAssignee(input.assigneeId,userId,projectId);
  if(input.dueDate!==undefined) {
    if(input.dueDate!==null && (typeof input.dueDate!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || !Number.isFinite(Date.parse(input.dueDate+"T00:00:00Z")) || new Date(input.dueDate+"T00:00:00Z").toISOString().slice(0,10)!==input.dueDate)) throw new IssueError("Use a valid due date (YYYY-MM-DD).");
    output.dueDate=input.dueDate;
  }
  if(input.parentId!==undefined) {
    output.parentId=nullableId(input.parentId,"parent issue");
    if(output.parentId) {
      const parent=requireIssue(output.parentId,userId);
      if(parent.projectId!==projectId || (!projectId && parent.ownerId!==userId)) throw new IssueError("Parent issue must belong to the same project.");
    }
  }
  return output;
}
function history(issueId:string,actorId:string,action:string,changes:IssueActivity["changes"]={}) {
  issueDatabase().prepare("INSERT INTO issue_history VALUES(?,?,?,?,?,?)").run(randomUUID(),issueId,actorId,action,JSON.stringify(changes),new Date().toISOString());
}
function write(issue:Issue) {
  issueDatabase().prepare("UPDATE issues SET parent_id=?,data=?,updated_at=? WHERE id=?").run(issue.parentId,JSON.stringify(issue),issue.updatedAt,issue.id);
  syncIssueDocument(issue);
}
export function listIssues(userId:string,input:{projectId?:string|null;noteId?:string;issuebookId?:string;search?:string;status?:string;assigneeId?:string}={}):Issue[] {
  const projectId=input.projectId || null;
  const key=container(userId,projectId);
  if(input.issuebookId) issuebook(userId,projectId,input.issuebookId);
  if(input.noteId) {
    const note=getNote(input.noteId,userId);
    if(!note || (note.projectId||null)!==projectId) throw new IssueError("Page not found",404);
  }
  const rows=issueDatabase().prepare("SELECT data,parent_id,project_id,owner_id FROM issues WHERE container_key=? ORDER BY updated_at DESC,id").all(key) as IssueRow[];
  const query=input.search?.trim().toLowerCase();
  return rows.map(row=>ensureIssueDocument(fromRow(row)!,userId)).filter(issue=>
    (!input.issuebookId || issue.issuebookId===input.issuebookId && !getNote(issue.noteId!,userId)?.archived) &&
    (!input.noteId || issue.source?.noteId===input.noteId) &&
    (!input.status || issue.status===input.status) &&
    (!input.assigneeId || issue.assigneeId===input.assigneeId) &&
    (!query || [issue.key,issue.title,issue.description,...issue.labels].some(value=>value.toLowerCase().includes(query)))
  );
}
/** Cross-container references include only live project memberships and the account's private issues. */
export function listAccessibleIssues(userId:string):Issue[] {
  userRequired(userId);
  const rows=issueDatabase().prepare(`
    SELECT i.data,i.parent_id,i.project_id,i.owner_id FROM issues i
    WHERE (i.project_id IS NULL AND i.owner_id=?)
      OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id
        AND (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)))
    ORDER BY i.updated_at DESC,i.id
  `).all(userId,userId,userId) as IssueRow[];
  return rows.map(row=>ensureIssueDocument(fromRow(row)!,userId));
}
function projectIssuePrefix(projectId:string|null) {
  if(!projectId) return "ISS";
  const db=issueDatabase();
  const existing=db.prepare("SELECT prefix FROM issue_project_keys WHERE project_id=?").get(projectId) as {prefix:string}|undefined;
  if(existing) return existing.prefix;
  const project=db.prepare("SELECT json_extract(data,'$.name') AS name FROM projects WHERE id=?").get(projectId) as {name:string};
  const words=project.name.normalize("NFKD").replace(/\p{M}/gu,"").toUpperCase().match(/[A-Z0-9]+/g)||[];
  const initials=words.length>1?words.map(word=>word[0]).join("").slice(0,6):words[0]?.slice(0,3);
  const base=initials&&/^[A-Z]/.test(initials)?initials:"PRJ";
  // No Project keeps ISS. Prefix ownership stays stable when a project is renamed.
  let prefix=base==="ISS"?"PRJ":base;
  let suffix=2;
  while(db.prepare("SELECT 1 FROM issue_project_keys WHERE prefix=?").get(prefix)) prefix=base+suffix++;
  db.prepare("INSERT INTO issue_project_keys(project_id,prefix) VALUES(?,?)").run(projectId,prefix);
  return prefix;
}
export function createIssue(userId:string,input:IssueWriteInput,requestKey?:string):Issue {
  const projectId=typeof input.projectId==="string" ? input.projectId.trim() || null : null;
  const key=container(userId,projectId);
  issueDatabase();
  return transaction(()=>{
    if(requestKey) {
      text(requestKey,240,"idempotency key",false);
      const previous=issueDatabase().prepare("SELECT issue_id FROM issue_request_keys WHERE owner_id=? AND container_key=? AND request_key=?").get(userId,key,requestKey) as {issue_id:string}|undefined;
      if(previous) return requireIssue(previous.issue_id,userId);
    }
    const book=issuebook(userId,projectId,input.issuebookId || (input.parentId ? requireIssue(input.parentId,userId).issuebookId : undefined));
    const source=normalizeSource(input.source,userId,projectId);
    if(source) {
      const previous=issueDatabase().prepare("SELECT id FROM issues WHERE container_key=? AND source_note_id=? AND source_id=?").get(key,source.noteId,source.sourceId) as {id:string}|undefined;
      if(previous) return requireIssue(previous.id,userId);
    }
    const fields=normalizedFields(input,userId,projectId);
    if(!fields.title) throw new IssueError("Enter an issue title.");
    const sequence=issueDatabase().prepare("INSERT INTO issue_counters VALUES(1,1) ON CONFLICT(id) DO UPDATE SET value=value+1 RETURNING value").get() as {value:number};
    const owner=projectId ? (issueDatabase().prepare("SELECT owner_id FROM projects WHERE id=?").get(projectId) as {owner_id:string}).owner_id : userId;
    const now=new Date().toISOString();
    const issue:Issue={id:randomUUID(),key:projectIssuePrefix(projectId)+"-"+sequence.value,projectId,ownerId:owner,creatorId:userId,title:fields.title,description:"",status:"backlog",priority:"none",labels:[],assigneeId:null,dueDate:null,parentId:null,source,createdAt:now,updatedAt:now,version:1,...fields,issuebookId:book.id};
    issueDatabase().prepare("INSERT INTO issues(id,issue_key,owner_id,project_id,container_key,parent_id,source_note_id,source_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(issue.id,issue.key,owner,projectId,key,issue.parentId,source?.noteId??null,source?.sourceId??null,JSON.stringify(issue),now,now);
    const linked=ensureIssueDocument(issue,userId);
    history(issue.id,userId,"created");
    if(requestKey) issueDatabase().prepare("INSERT INTO issue_request_keys VALUES(?,?,?,?)").run(userId,key,requestKey,issue.id);
    return linked;
  });
}
export function updateIssue(id:string,userId:string,input:IssueWriteInput):Issue {
  issueDatabase();
  return transaction(()=>{
    const issue=requireIssue(id,userId);
    if(input.projectId!==undefined && input.projectId!==issue.projectId) throw new IssueError("An issue stays in its original project.");
    if(input.source!==undefined) throw new IssueError("The original page source cannot be changed.");
    if(input.expectedVersion!==undefined && input.expectedVersion!==issue.version) throw new IssueError("This issue changed. Reload it before saving.",409);
    const fields=normalizedFields(input,userId,issue.projectId);
    if (input.issuebookId !== undefined) fields.issuebookId=issuebook(userId,issue.projectId,input.issuebookId).id;
    if(fields.parentId) {
      let cursor:string|null=fields.parentId;
      const visited=new Set<string>();
      while(cursor) {
        if(cursor===id || visited.has(cursor)) throw new IssueError("Subissues cannot form a cycle.");
        visited.add(cursor);
        cursor=requireIssue(cursor,userId).parentId;
      }
    }
    const changes:IssueActivity["changes"]={};
    for(const field of Object.keys(fields) as Array<keyof typeof fields>) {
      if(JSON.stringify(issue[field])!==JSON.stringify(fields[field])) changes[field]={before:issue[field],after:fields[field]};
    }
    if(!Object.keys(changes).length) return issue;
    const next={...issue,...fields,updatedAt:new Date().toISOString(),version:issue.version+1};
    write(next);
    history(id,userId,"updated",changes);
    return next;
  });
}
export function bulkUpdateIssues(userId:string,ids:string[],input:IssueWriteInput) {
  if(!Array.isArray(ids) || ids.length<1 || ids.length>100 || ids.some(id=>typeof id!=="string")) throw new IssueError("Select between 1 and 100 issues.");
  issueDatabase();
  return transaction(()=>{
    const issues=ids.map(id=>requireIssue(id,userId));
    const first=issues[0];
    if(issues.some(issue=>issue.projectId!==first.projectId || (!first.projectId && issue.ownerId!==first.ownerId))) throw new IssueError("Bulk changes require issues in one project.");
    return [...new Set(ids)].map(id=>updateIssue(id,userId,input));
  });
}
export function deleteIssue(id:string,userId:string) {
  issueDatabase();
  return transaction(()=>{
    const removing=requireIssue(id,userId);
    if (removing.noteId) {
      issueDatabase().prepare("UPDATE notes SET data=json_remove(data, '$.issueId') WHERE id=?").run(removing.noteId);
      deleteNote(removing.noteId,userId);
    }
    // Preserve children and record why their parent disappeared.
    const children=issueDatabase().prepare("SELECT id FROM issues WHERE parent_id=?").all(id) as Array<{id:string}>;
    for(const child of children) {
      const issue=requireIssue(child.id,userId);
      write({...issue,parentId:null,version:issue.version+1,updatedAt:new Date().toISOString()});
      history(child.id,userId,"updated",{parentId:{before:id,after:null}});
    }
    issueDatabase().prepare("DELETE FROM issues WHERE id=?").run(id);
    return {ok:true};
  });
}
export function addIssueComment(id:string,userId:string,body:unknown) {
  issueDatabase();
  return transaction(()=>{
    const issue=requireIssue(id,userId);
    const value=text(body,20_000,"comment",false),now=new Date().toISOString(),commentId=randomUUID();
    issueDatabase().prepare("INSERT INTO issue_comments VALUES(?,?,?,?,?)").run(commentId,id,userId,value,now);
    write({...issue,updatedAt:now});
    history(id,userId,"commented");
    return getIssueDetail(id,userId).comments.find(comment=>comment.id===commentId)!;
  });
}
export function addIssueRelation(id:string,userId:string,targetId:string,kind:"related"|"blocks"):IssueRelation {
  issueDatabase();
  return transaction(()=>{
    const issue=requireIssue(id,userId),target=requireIssue(targetId,userId);
    if(id===targetId || issue.projectId!==target.projectId || (!issue.projectId && issue.ownerId!==target.ownerId)) throw new IssueError("Choose another issue in the same project.");
    if(kind!=="related" && kind!=="blocks") throw new IssueError("Invalid relation.");
    if(kind==="blocks" && issueDatabase().prepare(`WITH RECURSIVE following(id) AS (SELECT target_id FROM issue_relations WHERE issue_id=? AND kind='blocks' UNION SELECT r.target_id FROM issue_relations r JOIN following f ON r.issue_id=f.id WHERE r.kind='blocks') SELECT 1 FROM following WHERE id=? LIMIT 1`).get(targetId,id)) throw new IssueError("Blocking relations cannot form a cycle.");
    const pair=kind==="related" && id>targetId ? [targetId,id] : [id,targetId];
    const previous=issueDatabase().prepare("SELECT id,issue_id AS issueId,target_id AS targetId,kind,created_at AS createdAt FROM issue_relations WHERE issue_id=? AND target_id=? AND kind=?").get(pair[0],pair[1],kind) as IssueRelation|undefined;
    if(previous) return previous;
    const relation:IssueRelation={id:randomUUID(),issueId:pair[0],targetId:pair[1],kind,createdAt:new Date().toISOString()};
    issueDatabase().prepare("INSERT INTO issue_relations VALUES(?,?,?,?,?)").run(relation.id,relation.issueId,relation.targetId,kind,relation.createdAt);
    history(id,userId,"linked",{relation:{before:null,after:{targetId,kind}}});
    return relation;
  });
}
export function removeIssueRelation(id:string,userId:string,relationId:string) {
  issueDatabase();
  return transaction(()=>{
    requireIssue(id,userId);
    const row=issueDatabase().prepare("SELECT id FROM issue_relations WHERE id=? AND (issue_id=? OR target_id=?)").get(relationId,id,id);
    if(!row) throw new IssueError("Relation not found",404);
    issueDatabase().prepare("DELETE FROM issue_relations WHERE id=?").run(relationId);
    history(id,userId,"unlinked");
    return {ok:true};
  });
}
export function getIssueDetail(id:string,userId:string):IssueDetail {
  const issue=requireIssue(id,userId),db=issueDatabase();
  const comments=db.prepare("SELECT c.id,c.issue_id AS issueId,c.author_id AS authorId,u.username AS authorName,c.body,c.created_at AS createdAt FROM issue_comments c JOIN users u ON u.id=c.author_id WHERE c.issue_id=? ORDER BY c.created_at,c.rowid").all(id) as IssueComment[];
  const rows=db.prepare("SELECT h.id,h.issue_id AS issueId,h.actor_id AS actorId,u.username AS actorName,h.action,h.changes,h.created_at AS createdAt FROM issue_history h JOIN users u ON u.id=h.actor_id WHERE h.issue_id=? ORDER BY h.created_at,h.rowid").all(id) as Array<Omit<IssueActivity,"changes">&{changes:string}>;
  const relations=db.prepare("SELECT id,issue_id AS issueId,target_id AS targetId,kind,created_at AS createdAt FROM issue_relations WHERE issue_id=? OR target_id=? ORDER BY created_at").all(id,id) as IssueRelation[];
  const subissues=(db.prepare("SELECT data,parent_id,project_id,owner_id FROM issues WHERE parent_id=? ORDER BY created_at").all(id) as IssueRow[]).map(row=>fromRow(row)!);
  return {issue,comments,history:rows.map(row=>({...row,changes:JSON.parse(row.changes)})),relations,subissues};
}
export function issueMembers(userId:string,projectId:string|null):IssueMember[] {
  container(userId,projectId);
  const db=issueDatabase();
  if(!projectId) return db.prepare("SELECT id AS userId,username FROM users WHERE id=?").all(userId) as IssueMember[];
  return db.prepare("SELECT u.id AS userId,u.username FROM users u WHERE u.id=(SELECT owner_id FROM projects WHERE id=?) OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=? AND m.user_id=u.id) ORDER BY u.username").all(projectId,projectId) as IssueMember[];
}
function filterSettings(value:unknown):IssueFilters {
  const raw=value && typeof value==="object" ? value as Record<string,unknown> : {};
  return {
    search:typeof raw.search==="string"?raw.search.slice(0,300):"",
    status:raw.status==="all" || ISSUE_STATUSES.includes(raw.status as never)?raw.status as string:"all",
    priority:raw.priority==="all" || ISSUE_PRIORITIES.includes(raw.priority as never)?raw.priority as string:"all",
    assignee:typeof raw.assignee==="string"?raw.assignee.slice(0,120):"all",
    label:typeof raw.label==="string"?raw.label.slice(0,60):"all",
    sort:["updated","created","priority","due"].includes(raw.sort as string)?raw.sort as IssueFilters["sort"]:"updated",
    mine:raw.mine===true,
  };
}
function normalizeSettings(value:unknown):IssueViewSettings {
  const input=value && typeof value==="object" ? value as Record<string,unknown> : {};
  return {layout:input.layout==="board"?"board":"list",filters:filterSettings(input.filters),savedViews:Array.isArray(input.savedViews)?input.savedViews.slice(0,30).flatMap(raw=>{
    if(!raw || typeof raw!=="object") return [];
    const view=raw as Record<string,unknown>;
    if(typeof view.id!=="string" || typeof view.name!=="string" || !view.name.trim()) return [];
    return [{id:view.id.slice(0,120),name:view.name.trim().slice(0,80),filters:filterSettings(view.filters)}];
  }):[]};
}
export function getIssueSettings(userId:string,projectId:string|null):IssueViewSettings {
  const key=container(userId,projectId);
  const row=issueDatabase().prepare("SELECT data FROM issue_view_settings WHERE owner_id=? AND container_key=?").get(userId,key) as {data:string}|undefined;
  return row?normalizeSettings(JSON.parse(row.data)):{layout:"list",filters:{...DEFAULT_ISSUE_FILTERS},savedViews:[]};
}
export function saveIssueSettings(userId:string,projectId:string|null,value:unknown) {
  const key=container(userId,projectId),settings=normalizeSettings(value);
  issueDatabase().prepare("INSERT INTO issue_view_settings VALUES(?,?,?) ON CONFLICT(owner_id,container_key) DO UPDATE SET data=excluded.data").run(userId,key,JSON.stringify(settings));
  return settings;
}
