import { getDatabase, parseData } from "@/lib/sqlite";
import type { Chat, ChatIndexEntry, Project } from "@/lib/store";

/** A membership is effective only after its invitation has been accepted. */
export function projectRole(projectId: string | undefined, userId: string | undefined): "owner" | "member" | null {
  if (!projectId || !userId) return null;
  const row = getDatabase().prepare("SELECT owner_id FROM projects WHERE id=?").get(projectId) as {owner_id:string}|undefined;
  if (!row) return null;
  if (row.owner_id === userId) return "owner";
  return getDatabase().prepare("SELECT 1 FROM project_members WHERE project_id=? AND user_id=?").get(projectId,userId) ? "member" : null;
}
/** Saved profile images are visible to project peers and owners managing a pending invite. */
export function canViewProjectMemberProfile(subjectId: string, viewerId: string | undefined): boolean {
  if (!viewerId) return false;
  return !!getDatabase().prepare(`SELECT 1 FROM projects p WHERE
    ((p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?))
      AND (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)))
    OR (p.owner_id=? AND EXISTS(SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=? AND i.status='pending'))
    LIMIT 1`).get(subjectId,subjectId,viewerId,viewerId,viewerId,subjectId);
}
export function canAccessChat(chatId: string, userId?: string) {
  if (!userId) return true; // Internal callers retain the existing unscoped contract.
  // The projection is maintained in the same transaction as chat writes. Reading
  // transcript JSON here makes every sidebar refresh parse every conversation.
  type AccessRow = {ownerId:string;projectId?:string;incognito:number;existingProject?:string;expiresAt?:string};
  const db = getDatabase();
  const row = db.prepare(`SELECT c.owner_id AS ownerId,c.project_id AS projectId,
    c.incognito,c.expires_at AS expiresAt,p.id AS existingProject
    FROM chat_list c LEFT JOIN projects p ON p.id=c.project_id WHERE c.id=?`).get(chatId) as AccessRow | undefined
    // Legacy/imported rows may not yet have a projection. Only those rows need JSON.
    ?? db.prepare(`SELECT c.owner_id AS ownerId,json_extract(c.data,'$.projectId') AS projectId,
      COALESCE(json_extract(c.data,'$.incognito'),0) AS incognito,json_extract(c.data,'$.expiresAt') AS expiresAt,p.id AS existingProject
      FROM chats c LEFT JOIN projects p ON p.id=json_extract(c.data,'$.projectId') WHERE c.id=?`).get(chatId) as AccessRow | undefined;
  if(!row || row.incognito && row.expiresAt && Date.parse(row.expiresAt)<=Date.now()) return false;
  if(row.existingProject) return !row.incognito && !!projectRole(row.projectId,userId);
  return row.ownerId===userId;
}
export function canAccessProjectResource(projectId:string|undefined,userId:string|undefined,creatorId:string|undefined) {
 if(!userId) return true;
 if(projectId && getDatabase().prepare("SELECT 1 FROM projects WHERE id=?").get(projectId)) return !!projectRole(projectId,userId);
 return creatorId===userId;
}
export function chatAssetOwnerId(chatId:string,userId?:string) {
 if(!userId || !canAccessChat(chatId,userId)) return userId;
 return (getDatabase().prepare("SELECT owner_id FROM chats WHERE id=?").get(chatId) as {owner_id:string}|undefined)?.owner_id || userId;
}
export function projectIsShared(projectId?: string) {
  return !!projectId && !!getDatabase().prepare("SELECT 1 FROM project_members WHERE project_id=? LIMIT 1").get(projectId);
}
export function projectUserSettings(projectId:string,userId:string) {
  return parseData<Record<string,unknown>>(getDatabase().prepare("SELECT data FROM project_user_settings WHERE project_id=? AND user_id=?").get(projectId,userId)) || {};
}
export function saveProjectUserSettings(projectId:string,userId:string,patch:Record<string,unknown>) {
  const next={...projectUserSettings(projectId,userId),...patch};
  getDatabase().prepare("INSERT INTO project_user_settings VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET data=excluded.data").run(projectId,userId,JSON.stringify(next));
}
export function projectForUser(project:Project,userId?:string):Project {
  if (!userId) return project;
  const role=projectRole(project.id,userId);
  if (!role) return project;
  const next={...project,membershipRole:role};
  if(role==="member") {
    delete next.defaultModelId; delete next.defaultModelParams;
    next.defaultModelEnabled=false; next.disabledSkillIds=[];
  }
  return {...next,...projectUserSettings(project.id,userId)} as Project;
}
const actorKey=Symbol("project-chat-actor");
const personalKeys=["agentId","modelId","modelParams","sessionState","browserContext","runtimeMode","approvedPatterns","queuedMessages"] as const;
type ActorChat=Chat & {[actorKey]?:string};
export function chatActor(chat:Chat) { return (chat as ActorChat)[actorKey]; }
function settings(chatId:string,userId:string) {
  return parseData<Record<string,unknown>>(getDatabase().prepare("SELECT data FROM chat_user_settings WHERE chat_id=? AND user_id=?").get(chatId,userId)) || {};
}
export function chatForUser(chat:Chat,userId?:string):Chat {
  if(!userId || !chat.projectId) return chat;
  const next={...chat} as ActorChat;
  if(chat.ownerId!==userId) for(const key of personalKeys) delete next[key];
  Object.assign(next,settings(chat.id,userId));
  next[actorKey]=userId; // Survives object spreads, but JSON never serializes symbol keys.
  return next;
}
export function chatIndexForUser(chat:ChatIndexEntry,userId?:string):ChatIndexEntry {
 if(!userId || !chat.projectId) return chat;
 const own=settings(chat.id,userId);
 return {...chat,
   modelId:typeof own.modelId==="string" ? own.modelId : chat.ownerId===userId ? chat.modelId : undefined,
   agentId:typeof own.agentId==="string" ? own.agentId : chat.ownerId===userId ? chat.agentId : undefined};
}
export function sharedChatForStorage(chat:Chat,before:Chat|null):Chat {
  const actor=(chat as ActorChat)[actorKey];
  if(!actor || !before) return chat;
  const own:Record<string,unknown>={};
  for(const key of personalKeys) if(chat[key]!==undefined) own[key]=chat[key];
  getDatabase().prepare("INSERT INTO chat_user_settings VALUES(?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET data=excluded.data").run(chat.id,actor,JSON.stringify(own));
  const next={...chat,ownerId:before.ownerId};
  delete (next as ActorChat)[actorKey];
  if(actor===before.ownerId) return next;
  for(const key of personalKeys) {
    delete next[key];
    if(before[key]!==undefined) (next as Record<string,unknown>)[key]=before[key];
  }
  return next;
}
