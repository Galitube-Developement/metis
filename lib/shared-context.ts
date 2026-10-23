import { canAccessProjectResource, projectRole } from "@/lib/project-access";
import { getCompletedUpload } from "@/lib/file-upload-store";
import { randomUUID } from "node:crypto";
import { syncIssueFromDocument } from "@/lib/issue-documents";
import { normalizeVoiceDictionary } from "@/lib/voice-dictionary";
import { getDatabase, isSqliteForeignKeyError, parseData, transaction, withSqliteRetry } from "@/lib/sqlite";
import type {
  NoteActivity,
  NoteAuthor,
  NoteKind,
  NoteScope,
  NoteTodo,
  SessionSnapshot,
  SharedNote,
  VoiceInputSettings,
  VoiceJobStatus,
  VoiceTranscriptionJob,
} from "@/lib/store";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_VOICE_DURATION_SECONDS = 3_600;
export const MAX_VOICE_BYTES = 250 * 1024 * 1024;
export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
]);

const iso = () => new Date().toISOString();

function idempotencyScope(scope: string, ownerId?: string) {
  return ownerId ? `${scope}:owner:${ownerId}` : scope;
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const NOTE_FORMAT_VERSION = 1;
export const MAX_NOTE_CONTENT_LENGTH = 50_000;

export class NoteValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "NoteValidationError";
  }
}

function noteText(value: unknown, max: number, field: string) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new NoteValidationError(`${field} must be a string.`);
  if (value.length > max) throw new NoteValidationError(`${field} exceeds the ${max.toLocaleString("en-US")} character limit.`, 413);
  return value;
}

function validScope(value: unknown): value is NoteScope {
  return value === "global" || value === "chat" || value === "workspace";
}

function rowToNote(row: unknown): SharedNote | null {
  const parsed = parseData<SharedNote>(row);
  if (!parsed || typeof parsed.id !== "string" || !validScope(parsed.scope)) return null;
  return {
    ...parsed,
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : "Untitled note",
    content: typeof parsed.content === "string" ? parsed.content : "",
    projectId: typeof parsed.projectId === "string" && parsed.projectId ? parsed.projectId : undefined,
    parentId: typeof parsed.parentId === "string" && parsed.parentId ? parsed.parentId : null,
    sortKey: Number.isFinite(parsed.sortKey) ? parsed.sortKey : 0,
    formatVersion: Number.isInteger(parsed.formatVersion) && parsed.formatVersion! > 0 ? parsed.formatVersion : NOTE_FORMAT_VERSION,
    icon: typeof parsed.icon === "string" ? parsed.icon : null,
    cover: typeof parsed.cover === "string" ? parsed.cover : null,
    fullWidth: Boolean(parsed.fullWidth),
    favorite: Boolean(parsed.favorite),
    color: /^#[0-9a-f]{6}$/i.test(parsed.color) ? parsed.color : "#fef08a",
    position: {
      x: Number.isFinite(parsed.position?.x) ? Math.max(-100_000, Math.min(100_000, parsed.position.x)) : 0,
      y: Number.isFinite(parsed.position?.y) ? Math.max(-100_000, Math.min(100_000, parsed.position.y)) : 0,
    },
    size: {
      width: Number.isFinite(parsed.size?.width) ? Math.max(160, Math.min(1_200, parsed.size.width)) : 280,
      height: Number.isFinite(parsed.size?.height) ? Math.max(120, Math.min(1_200, parsed.size.height)) : 220,
    },
    version: Math.max(1, Math.floor(parsed.version || 1)),
    archived: Boolean(parsed.archived),
  };
}

export function getIdempotentResponse<T>(scope: string, key: string, ownerId?: string, chatId?: string): T | null {
  if (!scope.trim() || !key.trim()) return null;
  const row = getDatabase().prepare(
    `SELECT response FROM idempotency_keys
     WHERE scope = ? AND key = ?
       AND (? IS NULL OR owner_id = ?)
       AND (? IS NULL OR chat_id = ?)`,
  ).get(idempotencyScope(scope, ownerId), key, ownerId ?? null, ownerId ?? null, chatId ?? null, chatId ?? null) as { response?: string } | undefined;
  if (!row?.response) return null;
  try {
    return JSON.parse(row.response) as T;
  } catch {
    return null;
  }
}

export function saveIdempotentResponse<T>(
  scope: string,
  key: string,
  response: T,
  ownerId?: string,
  chatId?: string,
) {
  const timestamp = iso();
  getDatabase().prepare(
    `INSERT INTO idempotency_keys (scope, key, owner_id, chat_id, response, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at`,
  ).run(idempotencyScope(scope, ownerId), key, ownerId ?? null, chatId ?? null, JSON.stringify(response), timestamp, timestamp);
  return response;
}

export type NoteWriteInput = {
  title?: string;
  content?: string;
  color?: string;
  kind?: NoteKind;
  uploadId?: string;
  todos?: NoteTodo[];
  position?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  archived?: boolean;
  scope?: NoteScope;
  chatId?: string;
  workspaceId?: string;
  projectId?: string | null;
  parentId?: string | null;
  sortKey?: number;
  formatVersion?: number;
  icon?: string | null;
  cover?: string | null;
  fullWidth?: boolean;
  favorite?: boolean;
  author?: NoteAuthor;
  expectedVersion?: number;
};

export function normalizeNoteTodos(value: unknown): NoteTodo[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).flatMap((item, index) => {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : { content: String(item || "") };
    const content = String(entry.content || "").trim().slice(0, 300);
    if (!content) return [];
    const status = entry.status === "in_progress" || entry.status === "completed" ? entry.status : "pending";
    const chatIds = Array.isArray(entry.chatIds)
      ? entry.chatIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim().slice(0, 120)).slice(0, 40)
      : undefined;
    return [{
      id: String(entry.id || `todo-${index + 1}`).slice(0, 80),
      content,
      status,
      ...(chatIds?.length ? { chatIds } : {}),
    }];
  });
}

export class NoteConflictError extends Error {
  current?: SharedNote;

  constructor(current?: SharedNote) {
    super("The note was changed by another client.");
    this.name = "NoteConflict";
    this.current = current;
  }
}

export function listNotes(input: {
  ownerId?: string;
  chatId?: string;
  workspaceId?: string;
  scope?: NoteScope;
  includeArchived?: boolean;
  search?: string;
  projectId?: string | null;
  parentId?: string | null;
}): SharedNote[] {
  const rows = getDatabase().prepare(
    `SELECT data FROM notes
     WHERE (? IS NULL OR owner_id = ? OR
       (COALESCE(json_extract(notes.data,'$.kind'),'note')!='learned_fact' AND EXISTS(
         SELECT 1 FROM projects p WHERE p.id=json_extract(notes.data,'$.projectId') AND
         (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)))))
       AND (? IS NULL OR scope = 'global' OR (scope = 'chat' AND chat_id = ?) OR (scope = 'workspace' AND workspace_id = ?))
       AND (? IS NULL OR scope = ?)
       AND (? = 1 OR archived = 0)
     ORDER BY updated_at DESC`,
  ).all(
    input.ownerId ?? null,
    input.ownerId ?? null,
    input.ownerId ?? null,
    input.ownerId ?? null,
    input.chatId ?? null,
    input.chatId ?? null,
    input.workspaceId ?? null,
    input.scope ?? null,
    input.scope ?? null,
    input.includeArchived ? 1 : 0,
  );
  const search = input.search?.trim().toLocaleLowerCase();
  const visible = rows.map(rowToNote)
    .filter((note): note is SharedNote => Boolean(note))
    .filter((note) => canAccessProjectResource(note.projectId, input.ownerId, note.ownerId));
  const children = new Map<string, number>();
  for (const note of visible) {
    if (note.parentId && note.kind !== "learned_fact") children.set(note.parentId, (children.get(note.parentId) ?? 0) + 1);
  }
  return visible
    .filter((note) => input.projectId === undefined || (note.projectId ?? null) === input.projectId)
    .filter((note) => input.parentId === undefined || (note.parentId ?? null) === input.parentId)
    .filter((note) => !search || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(search))
    .map((note) => ({ ...note, childCount: children.get(note.id) ?? 0, hasChildren: children.has(note.id) }))
    .sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function getNote(id: string, ownerId?: string, options?: { chatId?: string; workspaceId?: string }): SharedNote | null {
  if (!id.trim()) return null;
  const chatId = options?.chatId?.trim();
  const workspaceId = options?.workspaceId?.trim();
  const row = getDatabase().prepare(
    `SELECT data FROM notes
     WHERE id = ?
       AND (? IS NULL OR owner_id = ? OR
         (COALESCE(json_extract(notes.data,'$.kind'),'note')!='learned_fact' AND EXISTS(
           SELECT 1 FROM projects p WHERE p.id=json_extract(notes.data,'$.projectId') AND
           (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)))))
       AND (? IS NULL OR scope = 'global' OR (scope = 'chat' AND chat_id = ?) OR (scope = 'workspace' AND workspace_id = ?))`,
  ).get(id, ownerId ?? null, ownerId ?? null, ownerId ?? null, ownerId ?? null, (chatId || workspaceId) ?? null, chatId ?? null, workspaceId ?? null);
  const note=rowToNote(row);
  return note && canAccessProjectResource(note.projectId,ownerId,note.ownerId) ? note : null;
}

function noteActivity(
  note: SharedNote,
  action: NoteActivity["action"],
  actor: NoteAuthor,
  summary?: string,
  before?: SharedNote,
) {
  const activity: NoteActivity = {
    id: randomUUID(),
    noteId: note.id,
    actor,
    action,
    createdAt: iso(),
    ...(summary ? { summary: boundedText(summary, 500) } : {}),
    ...(before ? { before, after: note } : { after: note }),
  };
  getDatabase().prepare(
    "INSERT INTO note_activities (id, note_id, owner_id, chat_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(activity.id, note.id, note.ownerId ?? null, note.chatId ?? null, JSON.stringify(activity), activity.createdAt);
  return activity;
}

export function listNoteActivities(noteId: string, ownerId?: string) {
  if(!getNote(noteId,ownerId)) return [];
  const rows = getDatabase().prepare(
    `SELECT data FROM note_activities
     WHERE note_id = ?
     ORDER BY created_at DESC LIMIT 100`,
  ).all(noteId);
  return rows.map((row) => parseData<NoteActivity>(row)).filter((item): item is NoteActivity => Boolean(item));
}

export function validateNoteInput(input: NoteWriteInput, issueDocument = false) {
  if (input.title !== undefined) noteText(input.title, issueDocument ? 300 : 200, "Title");
  if (input.content !== undefined) noteText(input.content, issueDocument ? 100_000 : MAX_NOTE_CONTENT_LENGTH, "Content");
  for (const key of ["projectId", "parentId"] as const) {
    const value = input[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim() || value.length > 200)) {
      throw new NoteValidationError(`${key} must be a nonempty ID or null.`);
    }
  }
  if (input.sortKey !== undefined && (typeof input.sortKey !== "number" || !Number.isFinite(input.sortKey) || Math.abs(input.sortKey) > Number.MAX_SAFE_INTEGER)) {
    throw new NoteValidationError("sortKey must be a finite number within the safe integer range.");
  }
  if (input.formatVersion !== undefined && input.formatVersion !== NOTE_FORMAT_VERSION) {
    throw new NoteValidationError("Unsupported note formatVersion.");
  }
  for (const key of ["icon", "cover"] as const) {
    if (input[key] !== undefined && input[key] !== null) noteText(input[key], key === "icon" ? 100 : 2_048, key);
  }
  for (const key of ["fullWidth", "favorite"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw new NoteValidationError(`${key} must be a boolean.`);
  }
  if (input.expectedVersion !== undefined && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) {
    throw new NoteValidationError("version must be a positive integer.");
  }
}

/** Parse new page fields once for both the legacy create and update routes. */
export function notePageInputFromBody(body: Record<string, unknown>): NoteWriteInput {
  const input: NoteWriteInput = {};
  for (const key of ["parentId", "sortKey", "formatVersion", "icon", "cover", "fullWidth", "favorite"] as const) {
    if (Object.hasOwn(body, key)) Object.assign(input, { [key]: body[key] });
  }
  validateNoteInput(input);
  return input;
}

function pageMetadata(input: NoteWriteInput, current?: SharedNote) {
  return {
    formatVersion: input.formatVersion ?? current?.formatVersion ?? NOTE_FORMAT_VERSION,
    icon: input.icon !== undefined ? input.icon : current?.icon ?? null,
    cover: input.cover !== undefined ? input.cover : current?.cover ?? null,
    fullWidth: input.fullWidth ?? current?.fullWidth ?? false,
    favorite: input.favorite ?? current?.favorite ?? false,
  };
}

/** Includes archived/private descendants so a move cannot strand or expose hidden rows. */
function noteSubtree(id: string) {
  return getDatabase().prepare(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM notes WHERE id = ?
       UNION
       SELECT n.id FROM notes n JOIN subtree s ON json_extract(n.data, '$.parentId') = s.id
     ) SELECT n.data FROM notes n JOIN subtree s ON n.id = s.id`,
  ).all(id).map(rowToNote).filter((note): note is SharedNote => Boolean(note));
}

function noteDestination(input: NoteWriteInput & { ownerId?: string }, current?: SharedNote) {
  let projectId = input.projectId === null ? undefined : input.projectId ?? current?.projectId;
  let parentId = input.parentId !== undefined ? input.parentId : current?.parentId ?? null;
  if (input.parentId === undefined && input.projectId !== undefined && projectId !== current?.projectId) parentId = null;
  if (parentId) {
    if (parentId === current?.id) throw new NoteValidationError("A page cannot be its own parent.");
    const parent = getNote(parentId, input.ownerId);
    if (!parent || parent.kind === "learned_fact") throw new NoteValidationError("Parent page not found.");
    if (input.projectId === undefined && input.parentId !== undefined) projectId = parent.projectId;
    if (parent.projectId !== projectId) throw new NoteValidationError("Parent and child pages must be in the same project.");
    if (!projectId && parent.ownerId !== (current?.ownerId ?? input.ownerId)) throw new NoteValidationError("Private pages must belong to the same owner.");
  }
  if (projectId && input.ownerId && !projectRole(projectId, input.ownerId)) throw new NoteValidationError("Project not found.");
  if (projectId && !getDatabase().prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new NoteValidationError("Project not found.");
  let sortKey = input.sortKey;
  const changedParent = parentId !== (current?.parentId ?? null) || projectId !== current?.projectId;
  if (sortKey === undefined && current && !changedParent) sortKey = current.sortKey ?? 0;
  if (sortKey === undefined) {
    const row = getDatabase().prepare(
      `SELECT MAX(COALESCE(json_extract(data, '$.sortKey'), 0)) AS maximum FROM notes
       WHERE json_extract(data, '$.projectId') IS ? AND json_extract(data, '$.parentId') IS ?
         AND (? IS NOT NULL OR owner_id IS ?) AND id != ?`,
    ).get(projectId ?? null, parentId, projectId ?? null, current?.ownerId ?? input.ownerId ?? null, current?.id ?? "") as { maximum: number | null };
    sortKey = Math.max(0, row.maximum ?? 0) + 1024;
    if (!Number.isSafeInteger(sortKey)) throw new NoteValidationError("Page order is full. Choose a smaller sortKey.");
  }
  return { projectId, parentId, sortKey };
}

function writeNoteUpdate(next: SharedNote, current: SharedNote, actor: NoteAuthor) {
  const changed = getDatabase().prepare(
    "UPDATE notes SET data = ?, version = ?, archived = ?, updated_at = ? WHERE id = ? AND version = ?",
  ).run(JSON.stringify(next), next.version, next.archived ? 1 : 0, next.updatedAt, next.id, current.version);
  if (!changed.changes) throw new NoteConflictError(getNote(current.id) || current);
  noteActivity(next, next.archived !== current.archived ? next.archived ? "archived" : "restored" : "updated", actor, undefined, current);
}

export function createNote(input: NoteWriteInput & { ownerId?: string; idempotencyKey?: string }) {
  return transaction(() => {
    if (input.idempotencyKey) {
      const existing = getIdempotentResponse<SharedNote>("note:create", input.idempotencyKey, input.ownerId, input.chatId);
      if (existing) return existing;
    }
    validateNoteInput(input);
    const destination = noteDestination(input);
    const asset = input.uploadId && input.ownerId ? getCompletedUpload(input.ownerId, input.uploadId) : undefined;
    if ((input.kind === "image" || input.kind === "file") && !asset) throw new NoteValidationError("A completed upload is required");
    const timestamp = iso();
    const title = noteText(input.title, 200, "Title");
    const todos = normalizeNoteTodos(input.todos);
    const note: SharedNote = {
      id: randomUUID(),
      ...(input.ownerId ? { ownerId: input.kind === "issuebook" && destination.projectId ? (getDatabase().prepare("SELECT owner_id FROM projects WHERE id=?").get(destination.projectId) as {owner_id:string}).owner_id : input.ownerId } : {}),
      ...(input.chatId ? { chatId: input.chatId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      scope: input.scope || (input.workspaceId ? "workspace" : input.chatId ? "chat" : "global"),
      title: title.trim() ? title : input.kind === "project" ? "Untitled project" : "Untitled note",
      content: noteText(input.content, MAX_NOTE_CONTENT_LENGTH, "Content"),
      ...(asset ? { asset, kind: asset.kind } : { kind: input.kind === "project" || input.kind === "learned_fact" || input.kind === "issuebook" ? input.kind : "note" }),
      ...destination,
      ...pageMetadata(input),
      ...(todos.length ? { todos } : {}),
      color: /^#[0-9a-f]{6}$/i.test(input.color || "") ? String(input.color) : "#fef08a",
      position: {
        x: Math.max(-100_000, Math.min(100_000, Number(input.position?.x) || 0)),
        y: Math.max(-100_000, Math.min(100_000, Number(input.position?.y) || 0)),
      },
      size: {
        width: Math.max(160, Math.min(1_200, Number(input.size?.width) || 280)),
        height: Math.max(120, Math.min(1_200, Number(input.size?.height) || 220)),
      },
      author: input.author || "user",
      createdAt: timestamp,
      updatedAt: timestamp,
      archived: Boolean(input.archived),
      version: 1,
    };
    getDatabase().prepare(
      "INSERT INTO notes (id, owner_id, chat_id, workspace_id, scope, data, version, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(note.id, note.ownerId ?? null, note.chatId ?? null, note.workspaceId ?? null, note.scope, JSON.stringify(note), note.version, note.archived ? 1 : 0, timestamp, timestamp);
    noteActivity(note, "created", note.author);
    return input.idempotencyKey ? saveIdempotentResponse("note:create", input.idempotencyKey, note, input.ownerId, input.chatId) : note;
  });
}

export function updateNote(
  id: string,
  input: NoteWriteInput & { ownerId?: string; author?: NoteAuthor; idempotencyKey?: string },
) {
  return transaction(() => {
    if (input.idempotencyKey) {
      const existing = getIdempotentResponse<SharedNote>("note:update", input.idempotencyKey, input.ownerId);
      if (existing) {
        if (existing.id !== id) throw new NoteValidationError("This idempotency key was already used for a different note.");
        return existing;
      }
    }
    const current = getNote(id, input.ownerId);
    if (!current) return null;
    validateNoteInput(input, Boolean(current.issueId));
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) throw new NoteConflictError(current);
    const destination = noteDestination(input, current);
    const movingProject = destination.projectId !== current.projectId;
    if ((current.kind === "issuebook" || current.issueId) && input.kind !== undefined && input.kind !== current.kind) throw new NoteValidationError("Issuebook and issue file types cannot be changed.");
    const subtree = input.parentId !== undefined || movingProject || input.archived !== undefined ? noteSubtree(id) : [current];
    if (movingProject && subtree.some(note => note.kind === "issuebook" || note.issueId)) throw new NoteValidationError("Issuebooks and their issue files stay in their original project.");
    if (destination.parentId && subtree.some((note) => note.id === destination.parentId)) throw new NoteValidationError("A page cannot be moved into its descendants.");
    if (movingProject && input.ownerId && subtree.some((note) => note.ownerId !== input.ownerId)) {
      throw new NoteValidationError("Only the creator can move a page and all its descendants to another project.");
    }
    const timestamp = iso();
    const title = input.title !== undefined ? noteText(input.title, current.issueId ? 300 : 200, "Title") : undefined;
    const next: SharedNote = {
      ...current,
      ...(title !== undefined ? { title: title.trim() ? title : current.title } : {}),
      ...(input.content !== undefined ? { content: noteText(input.content, current.issueId ? 100_000 : MAX_NOTE_CONTENT_LENGTH, "Content") } : {}),
      ...(!current.asset && current.kind !== "learned_fact" && (input.kind === "project" || input.kind === "note") ? { kind: input.kind } : {}),
      ...destination,
      ...pageMetadata(input, current),
      ...(input.todos !== undefined ? { todos: normalizeNoteTodos(input.todos) } : {}),
      ...(input.color !== undefined && /^#[0-9a-f]{6}$/i.test(input.color) ? { color: input.color } : {}),
      ...(input.position ? { position: {
        x: Math.max(-100_000, Math.min(100_000, Number(input.position.x) || current.position.x)),
        y: Math.max(-100_000, Math.min(100_000, Number(input.position.y) || current.position.y)),
      } } : {}),
      ...(input.size ? { size: {
        width: Math.max(160, Math.min(1_200, Number(input.size.width) || current.size.width)),
        height: Math.max(120, Math.min(1_200, Number(input.size.height) || current.size.height)),
      } } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
      updatedAt: timestamp,
      version: current.version + 1,
    };
    if (movingProject || input.archived !== undefined) {
      for (const child of subtree) {
        if (child.id === current.id) continue;
        if (child.projectId !== current.projectId) throw new NoteValidationError("A descendant belongs to a different project.");
        writeNoteUpdate({
          ...child,
          ...(movingProject ? { projectId: destination.projectId } : {}),
          ...(input.archived !== undefined ? { archived: input.archived } : {}),
          updatedAt: timestamp,
          version: child.version + 1,
        }, child, input.author || "user");
      }
    }
    writeNoteUpdate(next, current, input.author || "user");
    if (current.issueId && (input.title !== undefined || input.content !== undefined || input.parentId !== undefined || movingProject)) syncIssueFromDocument(next, input.ownerId);
    return input.idempotencyKey ? saveIdempotentResponse("note:update", input.idempotencyKey, next, input.ownerId) : next;
  });
}

/** Move uses the same optimistic concurrency, idempotency and ACL rules as PATCH. */
export function moveNote(id: string, input: Pick<NoteWriteInput, "parentId" | "projectId" | "sortKey" | "expectedVersion"> & {
  ownerId?: string; idempotencyKey?: string; beforeId?: string; afterId?: string;
}) {
  if (input.beforeId !== undefined && input.afterId !== undefined) throw new NoteValidationError("Choose beforeId or afterId, not both.");
  const anchorId = input.beforeId ?? input.afterId;
  if (anchorId === undefined) {
    if (input.parentId === undefined && input.projectId === undefined && input.sortKey === undefined) throw new NoteValidationError("A destination or sortKey is required.");
    return updateNote(id, input);
  }
  if (typeof anchorId !== "string" || !anchorId.trim() || anchorId.length > 200 || anchorId === id) throw new NoteValidationError("Choose a different sibling page.");
  if (input.sortKey !== undefined) throw new NoteValidationError("Choose a sibling position or sortKey, not both.");
  return transaction(() => {
    if (input.idempotencyKey) {
      const previous = getIdempotentResponse<SharedNote>("note:update", input.idempotencyKey, input.ownerId);
      if (previous) {
        if (previous.id !== id) throw new NoteValidationError("This idempotency key was already used for a different note.");
        return previous;
      }
    }
    const current = getNote(id, input.ownerId);
    if (!current) return null;
    validateNoteInput(input, Boolean(current.issueId));
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) throw new NoteConflictError(current);
    const destination = noteDestination(input, current);
    const siblings = listNotes({ ownerId: input.ownerId, projectId: destination.projectId ?? null, parentId: destination.parentId, includeArchived: true })
      .filter(note => note.id !== id && note.kind !== "learned_fact");
    const anchorIndex = siblings.findIndex(note => note.id === anchorId);
    if (anchorIndex < 0) throw new NoteValidationError("The anchor must be a sibling in the destination project and parent.");
    const index = anchorIndex + (input.afterId !== undefined ? 1 : 0);
    const left = siblings[index - 1]?.sortKey, right = siblings[index]?.sortKey;
    let sortKey = left === undefined ? (right ?? 0) - 1024 : right === undefined ? left + 1024 : left + (right - left) / 2;
    if (!Number.isFinite(sortKey) || Math.abs(sortKey) > Number.MAX_SAFE_INTEGER || left !== undefined && sortKey <= left || right !== undefined && sortKey >= right) {
      const ordered = [...siblings.slice(0, index), current, ...siblings.slice(index)];
      const timestamp = iso();
      for (let offset = 0; offset < ordered.length; offset++) {
        const note = ordered[offset], key = (offset + 1) * 1024;
        if (note.id === id) { sortKey = key; continue; }
        if (note.sortKey !== key) {
          const { childCount: _childCount, hasChildren: _hasChildren, ...stored } = note;
          writeNoteUpdate({ ...stored, sortKey: key, updatedAt: timestamp, version: note.version + 1 }, stored, "user");
        }
      }
    }
    return updateNote(id, { ...input, sortKey });
  });
}

export function deleteNote(id: string, ownerId?: string) {
  return transaction(() => {
    const current = getNote(id, ownerId);
    if (!current) return false;
    if (current.issueId) throw new NoteValidationError("Delete the issue from its issue details, or move this file to trash.");
    if (noteSubtree(id).some(note => note.id !== id && (note.issueId || note.kind === "issuebook"))) throw new NoteValidationError("Move this tree to trash. Remove its issues before permanently deleting the issuebook.");
    // Keep surviving children reachable when the existing single-note delete API is used.
    const children = getDatabase().prepare("SELECT data FROM notes WHERE json_extract(data, '$.parentId') = ?").all(id);
    for (const row of children) {
      const child = rowToNote(row);
      if (child) writeNoteUpdate({ ...child, parentId: current.parentId ?? null, updatedAt: iso(), version: child.version + 1 }, child, "user");
    }
    getDatabase().prepare("DELETE FROM note_activities WHERE note_id = ?").run(id);
    getDatabase().prepare("DELETE FROM notes WHERE id = ?").run(id);
    return true;
  });
}

export function revertChatNotes(chatId: string, ownerId: string | undefined, cutoff: string) {
  return transaction(() => {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT a.id, a.note_id AS noteId, a.data
       FROM note_activities a
       JOIN notes n ON n.id = a.note_id
       WHERE n.chat_id = ? AND n.scope = 'chat'
         AND (? IS NULL OR n.owner_id = ?)
         AND a.created_at > ?
       ORDER BY a.created_at DESC`,
    ).all(chatId, ownerId ?? null, ownerId ?? null, cutoff) as Array<{
      id: string;
      noteId: string;
      data: string;
    }>;
    const reverted = new Set<string>();
    const deleted = new Set<string>();
    const restoreByNote = new Map<string, SharedNote>();
    for (const row of rows) {
      const activity = parseData<NoteActivity>({ data: row.data });
      if (!activity || deleted.has(row.noteId)) continue;
      if (activity.action === "created") {
        deleteNote(row.noteId, ownerId);
        deleted.add(row.noteId);
        reverted.add(row.noteId);
        continue;
      }
      if (activity.before) restoreByNote.set(row.noteId, activity.before);
    }
    for (const [noteId, before] of restoreByNote) {
      if (deleted.has(noteId)) continue;
      const current = getNote(noteId, ownerId);
      if (!current) continue;
      // Chat rewinds restore content without undoing workspace tree operations.
      const restored: SharedNote = {
        ...before,
        ...pageMetadata({}, current),
        projectId: current.projectId,
        parentId: current.parentId ?? null,
        sortKey: current.sortKey ?? 0,
        archived: current.archived,
        updatedAt: iso(),
        version: current.version + 1,
      };
      db.prepare(
        "UPDATE notes SET data = ?, version = ?, archived = ?, updated_at = ? WHERE id = ?",
      ).run(
        JSON.stringify(restored),
        restored.version,
        restored.archived ? 1 : 0,
        restored.updatedAt,
        restored.id,
      );
      db.prepare(
        "DELETE FROM note_activities WHERE note_id = ? AND created_at > ?",
      ).run(noteId, cutoff);
      reverted.add(noteId);
    }
    return [...reverted];
  });
}

function writeSnapshotRow(snapshot: SessionSnapshot) {
  const db = getDatabase();
  const serialized = JSON.stringify(snapshot);
  if (snapshot.checkpoint === "periodic") {
    const existing = db.prepare(
      `SELECT id FROM session_snapshots
       WHERE chat_id = ? AND checkpoint = 'periodic'
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(snapshot.chatId) as { id?: string } | undefined;
    if (existing?.id) {
      db.prepare(
        `UPDATE session_snapshots
         SET owner_id = ?, schema_version = ?, data = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        snapshot.ownerId ?? null,
        snapshot.schemaVersion,
        serialized,
        snapshot.updatedAt,
        existing.id,
      );
      return { ...snapshot, id: existing.id, createdAt: snapshot.createdAt };
    }
  }
  db.prepare(
    "INSERT INTO session_snapshots (id, chat_id, owner_id, schema_version, checkpoint, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(snapshot.id, snapshot.chatId, snapshot.ownerId ?? null, snapshot.schemaVersion, snapshot.checkpoint, serialized, snapshot.createdAt, snapshot.updatedAt);
  return snapshot;
}

export function saveSnapshot(snapshot: SessionSnapshot) {
  return withSqliteRetry(() => {
    try {
      return writeSnapshotRow(snapshot);
    } catch (error) {
      if (snapshot.ownerId && isSqliteForeignKeyError(error)) {
        const { ownerId: _ownerId, ...rest } = snapshot;
        return writeSnapshotRow(rest);
      }
      throw error;
    }
  });
}

export function getLatestSnapshot(chatId: string, ownerId?: string) {
  const rows = getDatabase().prepare(
    `SELECT data FROM session_snapshots
     WHERE chat_id = ? AND (? IS NULL OR owner_id = ?)
     ORDER BY updated_at DESC LIMIT 5`,
  ).all(chatId, ownerId ?? null, ownerId ?? null);
  for (const row of rows) {
    const snapshot = parseData<SessionSnapshot>(row);
    if (snapshot && snapshot.schemaVersion <= SNAPSHOT_SCHEMA_VERSION && snapshot.chatId === chatId) return snapshot;
  }
  return null;
}

export function createSnapshot(input: Omit<SessionSnapshot, "id" | "schemaVersion" | "createdAt" | "updatedAt">) {
  const timestamp = iso();
  return saveSnapshot({
    ...input,
    id: randomUUID(),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function normalizeVoiceSettings(settings?: Partial<VoiceInputSettings>): VoiceInputSettings {
  const provider =
    settings?.provider === "local" ||
    settings?.provider === "custom" ||
    settings?.provider === "browser"
      ? settings.provider
      : "openai";
  const modelId = typeof settings?.modelId === "string" && settings.modelId.trim()
    ? settings.modelId.trim().slice(0, 200)
    : provider === "openai" && settings?.realtime
      ? "gpt-realtime-whisper"
      : "whisper-1";
  return {
    enabled: settings?.enabled !== false,
    maxDurationSeconds: Math.max(1, Math.min(MAX_VOICE_DURATION_SECONDS, Math.floor(Number(settings?.maxDurationSeconds) || 300))),
    provider,
    modelId,
    realtime: settings?.realtime === true,
    ...(typeof settings?.endpoint === "string" && settings.endpoint.trim()
      ? { endpoint: settings.endpoint.trim().slice(0, 500) }
      : {}),
    ...(typeof settings?.connectionId === "string" && settings.connectionId.trim()
      ? { connectionId: settings.connectionId.trim().slice(0, 120) }
      : {}),
    ...(settings?.language?.trim() ? { language: settings.language.trim().slice(0, 20) } : {}),
    dictionary: normalizeVoiceDictionary(settings?.dictionary),
    autoInsertDraft: settings?.autoInsertDraft !== false,
    deleteAudioAfterTranscription: settings?.deleteAudioAfterTranscription !== false,
  };
}

export function createVoiceJob(input: {
  ownerId?: string;
  chatId?: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  idempotencyKey?: string;
}) {
  if (!ALLOWED_AUDIO_MIME_TYPES.has(input.mimeType)) throw new Error("Unsupported audio MIME type.");
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > MAX_VOICE_DURATION_SECONDS) {
    throw new Error(`Audio duration must be between 1 and ${MAX_VOICE_DURATION_SECONDS} seconds.`);
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_VOICE_BYTES) {
    throw new Error("Audio file is too large.");
  }
  if (input.idempotencyKey) {
    const existing = getIdempotentResponse<VoiceTranscriptionJob>("voice:create", input.idempotencyKey, input.ownerId, input.chatId);
    if (existing) return existing;
  }
  const timestamp = iso();
  const job: VoiceTranscriptionJob = {
    id: randomUUID(),
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    ...(input.chatId ? { chatId: input.chatId } : {}),
    status: "queued",
    mimeType: input.mimeType,
    durationSeconds: input.durationSeconds,
    sizeBytes: input.sizeBytes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  getDatabase().prepare(
    "INSERT INTO voice_jobs (id, owner_id, chat_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(job.id, job.ownerId ?? null, job.chatId ?? null, job.status, JSON.stringify(job), timestamp, timestamp);
  return input.idempotencyKey
    ? saveIdempotentResponse("voice:create", input.idempotencyKey, job, input.ownerId, input.chatId)
    : job;
}

export function getVoiceJob(id: string, ownerId?: string) {
  const row = getDatabase().prepare(
    "SELECT data FROM voice_jobs WHERE id = ? AND (? IS NULL OR owner_id = ?)",
  ).get(id, ownerId ?? null, ownerId ?? null);
  return parseData<VoiceTranscriptionJob>(row);
}

export function updateVoiceJob(id: string, patch: Partial<Pick<VoiceTranscriptionJob, "status" | "transcript" | "error">>, ownerId?: string) {
  const current = getVoiceJob(id, ownerId);
  if (!current) return null;
  const updated: VoiceTranscriptionJob = { ...current, ...patch, updatedAt: iso() };
  getDatabase().prepare("UPDATE voice_jobs SET status = ?, data = ?, updated_at = ? WHERE id = ?").run(updated.status, JSON.stringify(updated), updated.updatedAt, id);
  return updated;
}

export function listVoiceJobs(ownerId?: string, chatId?: string) {
  const rows = getDatabase().prepare(
    `SELECT data FROM voice_jobs
     WHERE (? IS NULL OR owner_id = ?)
       AND (? IS NULL OR chat_id = ?)
     ORDER BY updated_at DESC LIMIT 50`,
  ).all(ownerId ?? null, ownerId ?? null, chatId ?? null, chatId ?? null);
  return rows.map((row) => parseData<VoiceTranscriptionJob>(row)).filter((job): job is VoiceTranscriptionJob => Boolean(job));
}

export function isVoiceJobStatus(status: string): status is VoiceJobStatus {
  return ["queued", "uploading", "transcribing", "completed", "failed", "cancelled"].includes(status);
}
