/** Hide immediately, suppress stale live-sync echoes, and roll back failed deletes. */
export async function removeQueuedFollowUp(options: {
  chatId: string | null;
  messageId: string;
  removedIds: Set<string>;
  removeLocally: () => void;
  restoreLocally: () => void;
  request?: typeof fetch;
}) {
  const { chatId, messageId, removedIds, removeLocally, restoreLocally } = options;
  if (removedIds.has(messageId)) return false;
  removedIds.add(messageId);
  removeLocally();
  if (!chatId) return true;
  try {
    const response = await (options.request ?? fetch)(
      `/api/chats/${encodeURIComponent(chatId)}/queue/${encodeURIComponent(messageId)}`,
      { method: "DELETE", keepalive: true },
    );
    if (!response.ok) throw new Error("Could not remove queued message. Please try again.");
    return true;
  } catch (error) {
    removedIds.delete(messageId);
    restoreLocally();
    throw error;
  }
}
