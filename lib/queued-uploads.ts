import { materializeUploads } from "@/lib/file-upload-store";
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from "@/lib/upload-limits";
import type { Chat } from "@/lib/store";

export type QueuedUploadMessage = NonNullable<Chat["queuedMessages"]>[number] & { uploadIds?: string[] };

/** Bind finished owner uploads before a queued prompt can become visible to the worker. */
export function materializeQueuedUploads(chatId: string, queue: QueuedUploadMessage[] | null | undefined, ownerId: string) {
  if (queue == null) return queue;
  if (!Array.isArray(queue) || queue.length > 50) throw new Error("Invalid message queue");
  return queue.map(item => {
    if (!item || typeof item.id !== "string" || typeof item.text !== "string") throw new Error("Invalid queued message");
    const { uploadIds, ...message } = item;
    if (uploadIds === undefined) return message;
    if (!Array.isArray(uploadIds) || !uploadIds.every(id => typeof id === "string")) throw new Error("Invalid queued uploads");
    const attachments = [...(message.attachments ?? []), ...materializeUploads(chatId, uploadIds, ownerId)];
    const unique = [...new Map(attachments.map(file => [file.id, file])).values()];
    if (unique.length > MAX_ATTACHMENTS || unique.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      throw new Error("Queued attachments exceed the attachment limit");
    }
    return { ...message, attachments: unique };
  });
}
