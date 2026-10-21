import type { AccountIdentity } from "@/lib/account-types";

export type ProjectMessageMember = AccountIdentity & { userId: string; username: string };

export function projectMessageMembers(payload: unknown): ProjectMessageMember[] {
  const members = (payload as { members?: unknown } | null)?.members;
  if (!Array.isArray(members)) throw new Error("Invalid project members");
  const unique = new Map<string, ProjectMessageMember>();
  for (const member of members) {
    if (!member || typeof member.userId !== "string" || !member.userId || typeof member.username !== "string") throw new Error("Invalid project member");
    unique.set(member.userId, { userId: member.userId, username: member.username,
      displayName: typeof member.displayName === "string" ? member.displayName.trim() : "",
      avatar: typeof member.avatar === "string" ? member.avatar : null });
  }
  return [...unique.values()];
}

export function projectMessageAuthor(members: ProjectMessageMember[], message: { authorId?: string; authorName?: string }): AccountIdentity | null {
  if (new Set(members.map(member => member.userId)).size < 2) return null;
  // IDs are authoritative; legacy username matching only applies without an ID.
  const member = message.authorId ? members.find(member => member.userId === message.authorId)
    : members.find(member => member.username === message.authorName);
  const name = member?.displayName.trim() || member?.username.trim() || message.authorName?.trim();
  return name ? { displayName: name, avatar: member?.avatar || null } : null;
}
