import { getChat, upsertMessage } from "@/lib/db-store";
import { getDatabase, transaction } from "@/lib/sqlite";
import type { StoredAttachment } from "@/lib/uploads";

/** Register the file before returning its URL, independently of provider tool telemetry. */
export function registerProvidedFile(
  chatId: string,
  jobId: string,
  ownerId: string | undefined,
  attachment: StoredAttachment,
) {
  return transaction(() => {
    const event = getDatabase().prepare(
      `SELECT e.data FROM run_events e JOIN jobs j ON j.id = e.job_id
       WHERE e.job_id = ? AND e.chat_id = ? AND j.chat_id = ?
         AND j.user_id IS ? AND e.user_id IS ? AND e.event = 'assistantId'
       ORDER BY e.id DESC LIMIT 1`,
    ).get(jobId, chatId, chatId, ownerId ?? null, ownerId ?? null) as { data: string } | undefined;
    const messageId = event ? (JSON.parse(event.data) as { messageId?: string }).messageId : undefined;
    const chat = getChat(chatId, ownerId);
    const message = chat?.messages.find((item) => item.id === messageId && item.role === "assistant");
    if (!message) throw new Error("The active assistant message could not be found.");
    const attachments = message.attachments ?? [];
    const saved = upsertMessage(chatId, {
      ...message,
      attachments: attachments.some((item) => item.id === attachment.id)
        ? attachments
        : [...attachments, attachment],
    });
    if (!saved) throw new Error("Could not register the file in the chat.");
    return attachment;
  });
}
