import { getGlobalModelSettings } from "@/lib/db-store";
import { DEFAULT_ATTACHMENT_MAX_BYTES, normalizeAttachmentMaxBytes, validateAttachmentSize } from "@/lib/upload-limits";

export function getAttachmentMaxBytes(ownerId?: string): number {
  return ownerId
    ? normalizeAttachmentMaxBytes(getGlobalModelSettings(ownerId).attachmentMaxBytes)
    : DEFAULT_ATTACHMENT_MAX_BYTES;
}

/** Validate before accepting bytes; existing completed uploads keep their acceptance. */
export function validateOwnerAttachmentSize(size: number, name: string, ownerId?: string) {
  validateAttachmentSize(size, getAttachmentMaxBytes(ownerId), name);
}
