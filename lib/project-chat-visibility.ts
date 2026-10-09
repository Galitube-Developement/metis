/** Sidebar visibility only: project chats remain available to search and direct links. */
export function filterProjectChats<T extends { projectId?: string | null; archived?: boolean }>(
 chats: readonly T[],
 projects: readonly { id: string; hideChatsFromAll?: boolean }[],
 activeProjectId?: string | null,
): T[] {
 const hiddenProjects = new Set(projects.filter(project => project.hideChatsFromAll === true).map(project => project.id));
 return chats.filter(chat => !chat.archived && (
  activeProjectId ? chat.projectId === activeProjectId : !chat.projectId || !hiddenProjects.has(chat.projectId)
 ));
}
