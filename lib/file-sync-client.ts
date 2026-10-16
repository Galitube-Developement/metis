import type { FileSnapshot } from "@/lib/file-sync";

export class FileSyncError extends Error {
  constructor(message: string, public status: number, public snapshot?: FileSnapshot) { super(message); }
}
export async function requestFileSnapshot(body: { action: "snapshot" | "save"; path: string; revision?: string; content?: string }, signal?: AbortSignal): Promise<FileSnapshot & { unchanged?: boolean }> {
  const response = await fetch("/api/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  let data: { error?: string; content?: string; revision?: string; unchanged?: boolean };
  try { data = await response.json(); } catch { throw new FileSyncError("The file server did not return a complete snapshot.", response.status); }
  const valid = typeof data.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision) && typeof data.content === "string";
  if (!response.ok) throw new FileSyncError(data.error || "File synchronization failed.", response.status, valid ? { content: data.content!, revision: data.revision! } : undefined);
  if (data.unchanged === true && typeof data.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision)) return { content: "", revision: data.revision, unchanged: true };
  if (!valid) throw new FileSyncError("The file server returned an incomplete snapshot.", 502);
  return { content: data.content!, revision: data.revision! };
}
