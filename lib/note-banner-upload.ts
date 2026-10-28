import { MAX_INLINE_IMAGE_BYTES } from "@/lib/upload-limits";

export const NOTE_BANNER_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const bannerTypes = new Set(NOTE_BANNER_ACCEPT.split(","));

/** Use the note's attachment namespace so banners keep the note's project access. */
export async function uploadNoteBanner(
  noteId: string,
  file: File,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<string> {
  if (!bannerTypes.has(file.type)) throw new Error("Choose a PNG, JPG, WebP or GIF image.");
  if (!file.size) throw new Error("Choose a non-empty image.");
  if (file.size > MAX_INLINE_IMAGE_BYTES) throw new Error("Choose an image smaller than 20 MB.");
  const form = new FormData();
  form.append("files", file);
  const response = await request("/api/notes/" + encodeURIComponent(noteId) + "/attachments", {
    method: "POST", body: form, signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not upload the banner. Try again.");
  const attachment = body.attachments?.[0];
  const prefix = "/api/notes/" + encodeURIComponent(noteId) + "/attachments/";
  if (!attachment || !bannerTypes.has(attachment.mimeType) || typeof attachment.url !== "string" ||
      !attachment.url.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(attachment.url.slice(prefix.length))) {
    throw new Error("The banner upload returned an invalid image. Try again.");
  }
  return attachment.url;
}
