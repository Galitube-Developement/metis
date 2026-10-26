import { getChatMetadata, updateChat } from "@/lib/db-store";
import { projectIsShared, projectRole } from "@/lib/project-access";
import { getProject, listProjects } from "@/lib/projects";
import { getProjectAgentForChat } from "@/lib/project-team";

export class ChatProjectError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function chatProjectChoices(userId: string) {
  return listProjects(userId).filter(project => project.mode !== "agents").map(project => ({
    id: project.id,
    name: project.name,
    role: project.membershipRole,
    shared: projectIsShared(project.id),
  }));
}

/** The same ownership and project-mode rules apply to UI and agent moves. */
export function validateChatProjectMove(chatId: string, projectId: string | null, userId: string) {
  const chat = getChatMetadata(chatId, userId);
  if (!chat) throw new ChatProjectError("Chat not found", 404);
  if (chat.incognito) throw new ChatProjectError("Private chats cannot be moved to projects.");
  const teamAgent = getProjectAgentForChat(chatId, userId);
  if (teamAgent && projectId !== teamAgent.projectId) {
    throw new ChatProjectError("Agent chats remain in their project.");
  }
  const project = projectId ? getProject(projectId, userId) : null;
  if (projectId && !project) throw new ChatProjectError("Project not found", 404);
  if (!teamAgent && project?.mode === "agents") {
    throw new ChatProjectError("Create an agent to join an agent-oriented project.");
  }
  if ((chat.projectId || null) !== projectId && chat.ownerId !== userId
    && !(projectId === null && projectRole(chat.projectId, userId) === "owner")) {
    throw new ChatProjectError("Only the chat creator can move this chat.", 403);
  }
  return project;
}

export function moveChatToProject(chatId: string, projectId: string | null, userId: string) {
  const project = validateChatProjectMove(chatId, projectId, userId);
  const chat = updateChat(chatId, { projectId, touchUpdatedAt: false }, userId, { metadataProjection: true });
  if (!chat) throw new ChatProjectError("Chat not found", 404);
  return { chatId: chat.id, projectId: chat.projectId || null, projectName: project?.name || null };
}
