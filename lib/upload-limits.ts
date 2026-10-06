/** Shared transport limits; files are transferred in bounded chunks. */
export const MAX_ATTACHMENTS = 10;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const MAX_TOTAL_BYTES = MAX_ATTACHMENTS * MAX_FILE_BYTES;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
export type UploadedFile = {
  id: string; name: string; mimeType: string; size: number; kind: "image" | "file";
};
export function formatFileBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}
