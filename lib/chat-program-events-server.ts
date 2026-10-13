import { getDatabase, parseData } from "@/lib/sqlite";
import type { ChatMessage } from "@/lib/store";
import type { ProjectHandoff } from "@/lib/project-team-types";

const programHandoffId = /^handoff:([\da-f-]{36}):(sent|assignment|result:(?:sender|recipient))$/i;

/** UI metadata comes from owned durable records, never from matching user prose. */
export function withChatProgramEvents(messages: ChatMessage[], chatId: string, ownerId: string): ChatMessage[] {
  if (!messages.length) return messages;
  const db = getDatabase();
  const userMessageIds = messages.filter(message => message.role === "user").map(message => message.id);
  const reviews = userMessageIds.length ? db.prepare(
    `SELECT json_extract(data, '$.messageId') AS messageId, status FROM jobs
     WHERE chat_id = ? AND user_id = ? AND json_extract(data, '$.subagentFollowUp') = 1
     AND json_extract(data, '$.messageId') IN (${userMessageIds.map(() => "?").join(",")})`,
  ).all(chatId, ownerId, ...userMessageIds) as { messageId: string; status: string }[] : [];
  const reviewStates = new Map(reviews.map(review => [review.messageId, review.status]));
  const ids = [...new Set(messages.flatMap(message => {
    const id = programHandoffId.exec(message.id)?.[1];
    return id ? [id] : [];
  }))];
  const handoffs = new Map<string, ProjectHandoff & { recipientChatId?: string; prompt?: string }>();
  if (ids.length) {
    const rows = db.prepare(
      `SELECT h.data, recipient.chat_id AS recipientChatId, json_extract(j.data, '$.message') AS prompt
       FROM project_handoffs h
       LEFT JOIN project_agents recipient ON recipient.id = json_extract(h.data, '$.recipientAgentId')
         AND recipient.project_id = h.project_id AND recipient.owner_id = h.owner_id
       LEFT JOIN jobs j ON j.id = json_extract(h.data, '$.jobId')
         AND j.user_id = h.owner_id AND j.chat_id = recipient.chat_id
       WHERE h.owner_id = ? AND h.id IN (${ids.map(() => "?").join(",")})
       AND EXISTS (SELECT 1 FROM project_agents a WHERE a.owner_id = h.owner_id
         AND a.project_id = h.project_id AND a.chat_id = ?
         AND a.id IN (json_extract(h.data, '$.senderAgentId'), json_extract(h.data, '$.recipientAgentId')))`,
    ).all(ownerId, ...ids, chatId);
    for (const row of rows) {
      const handoff = parseData<ProjectHandoff>(row);
      const details = row as { recipientChatId?: string; prompt?: string };
      if (handoff) handoffs.set(handoff.id, { ...handoff, recipientChatId: details.recipientChatId || undefined, prompt: typeof details.prompt === "string" ? details.prompt : undefined });
    }
  }
  return messages.map(message => {
    const review = reviewStates.get(message.id);
    if (review && message.role === "user") return { ...message, programEvent: { type: "team-review", status: review } };
    const match = programHandoffId.exec(message.id);
    const handoff = match ? handoffs.get(match[1]) : undefined;
    const expectedRole = match?.[2] === "assignment" ? "user" : "assistant";
    if (!handoff || message.role !== expectedRole) return message;
    return { ...message, programEvent: { type: "handoff", activity: {
      id: handoff.id,
      sender: handoff.senderName || "You",
      recipient: handoff.recipientName || "Agent",
      status: handoff.status,
      task: handoff.task,
      projectId: handoff.projectId,
      recipientAgentId: handoff.recipientAgentId,
      recipientChatId: handoff.recipientChatId,
      prompt: handoff.prompt,
      context: handoff.context,
      result: handoff.result,
      error: handoff.error,
    } } };
  });
}
