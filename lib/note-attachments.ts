import { getDatabase } from "@/lib/sqlite";
import { canAccessProjectResource } from "@/lib/project-access";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentCwd } from "@/lib/mcp";
import { isImageMime, MAX_ATTACHMENTS, sanitizeFileName } from "@/lib/uploads";
import { validateOwnerAttachmentSize } from "@/lib/attachment-settings";

export function validateNoteFiles(files: readonly Pick<File, "name" | "size">[], ownerId?: string) {
  if (!files.length) throw new Error("Choose at least one file.");
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Choose up to ${MAX_ATTACHMENTS} files at a time.`);
  for (const file of files) {
    if (!file.size) throw new Error(`File is empty: ${file.name}`);
    validateOwnerAttachmentSize(file.size, file.name, ownerId);
  }
}

function attachmentDir(noteId: string, ownerId?: string) {
  // Note IDs become directory names only after resolving an owned note.
  const note=getDatabase().prepare("SELECT owner_id,json_extract(data,'$.projectId') AS projectId FROM notes WHERE id=?").get(noteId) as {owner_id?:string;projectId?:string}|undefined;
  const fileOwner=note && canAccessProjectResource(note.projectId,ownerId,note.owner_id) ? note.owner_id : ownerId;
  return path.join(getAgentCwd(fileOwner), ".note-attachments", encodeURIComponent(noteId));
}

export async function storeNoteFiles(noteId: string, files: File[], ownerId?: string) {
  validateNoteFiles(files, ownerId);
  const dir = attachmentDir(noteId, ownerId);
  await mkdir(dir, { recursive: true });
  const attachments = [];
  for (const file of files) {
    const id = randomUUID();
    const name = sanitizeFileName(file.name);
    const mimeType = isImageMime(file.type) ? file.type.toLowerCase().split(";")[0].trim() : "application/octet-stream";
    const meta = { id, name, mimeType, kind: isImageMime(mimeType) ? "image" : "file" };
    await writeFile(path.join(dir, id), new Uint8Array(await file.arrayBuffer()));
    await writeFile(path.join(dir, id + ".json"), JSON.stringify(meta));
    attachments.push({ ...meta, url: `/api/notes/${encodeURIComponent(noteId)}/attachments/${id}` });
  }
  return attachments;
}

export async function readNoteFile(noteId: string, id: string, ownerId?: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const dir = attachmentDir(noteId, ownerId);
  try {
    const meta = JSON.parse(await readFile(path.join(dir, id + ".json"), "utf8")) as { name: string; mimeType: string; kind: string };
    const data = await readFile(path.join(dir, id));
    return { ...meta, data };
  } catch {
    return null;
  }
}

export async function resolveNoteFile(noteId:string,id:string,ownerId?:string) {
  if(!/^[a-f0-9-]{36}$/.test(id))return null;
  const dir=attachmentDir(noteId,ownerId);
  try { const meta=JSON.parse(await readFile(path.join(dir,id+".json"),"utf8")); return {meta,path:path.join(dir,id)}; } catch {return null;}
}
