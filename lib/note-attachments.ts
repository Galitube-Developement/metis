import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentCwd } from "@/lib/mcp";
import { isImageMime, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_TOTAL_BYTES, sanitizeFileName } from "@/lib/uploads";

export function validateNoteFiles(files: readonly Pick<File, "name" | "size">[]) {
  if (!files.length) throw new Error("Choose at least one file.");
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Choose up to ${MAX_ATTACHMENTS} files at a time.`);
  let total = 0;
  for (const file of files) {
    if (!file.size) throw new Error(`File is empty: ${file.name}`);
    if (file.size > Math.min(MAX_FILE_BYTES, 50 * 1024 * 1024)) throw new Error(`File exceeds 50 MB: ${file.name}`);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("Files exceed the total size limit.");
}

function attachmentDir(noteId: string, ownerId?: string) {
  // Note IDs become directory names only after resolving an owned note.
  return path.join(getAgentCwd(ownerId), ".note-attachments", encodeURIComponent(noteId));
}

export async function storeNoteFiles(noteId: string, files: File[], ownerId?: string) {
  validateNoteFiles(files);
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
