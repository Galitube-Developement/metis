import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import { projectRole } from "@/lib/project-access";
import { createNotification, notificationDatabase } from "@/lib/notification-store";

export class ProjectSharingError extends Error {
  constructor(message:string, public status=400) { super(message); }
}
type Invitation={id:string;project_id:string;inviter_id:string;invitee_id:string;status:"pending"|"accepted"|"declined"|"revoked"};
function requireAccess(projectId:string,userId:string,manage=false) {
  const role=projectRole(projectId,userId);
  if(!role) throw new ProjectSharingError("Project not found",404);
  if(manage && role!=="owner") throw new ProjectSharingError("Only the project owner can manage invitations and members.",403);
  return role;
}
export function projectMembers(projectId:string,userId:string) {
  const role=requireAccess(projectId,userId);
  const db=getDatabase();
  // Project peers only receive the identity needed for member rows, never private profile details.
  const identity="u.id AS userId,u.username,COALESCE(NULLIF(trim(json_extract(ap.data,'$.displayName')),''),u.username) AS displayName,json_extract(ap.data,'$.avatar') AS avatar";
  const members=db.prepare(`SELECT ${identity},'owner' AS role FROM users u JOIN projects p ON p.owner_id=u.id LEFT JOIN account_profiles ap ON ap.owner_id=u.id WHERE p.id=?
    UNION ALL SELECT ${identity},'member' AS role FROM users u JOIN project_members m ON m.user_id=u.id LEFT JOIN account_profiles ap ON ap.owner_id=u.id WHERE m.project_id=?`).all(projectId,projectId);
  const invitations=role==="owner" ? db.prepare(`SELECT i.id,${identity},i.status FROM project_invitations i JOIN users u ON u.id=i.invitee_id LEFT JOIN account_profiles ap ON ap.owner_id=u.id WHERE i.project_id=? AND i.status='pending' ORDER BY i.created_at DESC`).all(projectId) : [];
  return {canManage:role==="owner",members,invitations};
}
export function inviteProjectMember(projectId:string,userId:string,username:string) {
  requireAccess(projectId,userId,true);
  const name=username.trim();
  if(!name || name.length>120) throw new ProjectSharingError("Enter a username or @handle.");
  return transaction(()=>{
    const db=getDatabase();
    const recipient=name.startsWith("@")
      ? db.prepare("SELECT u.id,u.username FROM account_profile_handles h JOIN users u ON u.id=h.owner_id WHERE h.handle=?").get(name.slice(1).toLowerCase())
      : db.prepare("SELECT id,username FROM users WHERE username=?").get(name);
    const target=recipient as {id:string;username:string}|undefined;
    if(!target) throw new ProjectSharingError("No account found for this username or handle.",404);
    if(projectRole(projectId,target.id)) throw new ProjectSharingError("This user already belongs to the project.");
    const existing=db.prepare("SELECT id FROM project_invitations WHERE project_id=? AND invitee_id=? AND status='pending'").get(projectId,target.id) as {id:string}|undefined;
    if(existing) return {id:existing.id,status:"pending",username:target.username};
    const id=randomUUID(),now=new Date().toISOString();
    const project=db.prepare("SELECT json_extract(data,'$.name') AS name FROM projects WHERE id=?").get(projectId) as {name:string};
    const sender=db.prepare("SELECT username FROM users WHERE id=?").get(userId) as {username:string};
    db.prepare("INSERT INTO project_invitations VALUES(?,?,?,?,?,?,NULL)").run(id,projectId,userId,target.id,"pending",now);
    const notification=createNotification(target.id,{title:"Project invitation",body:sender.username+" invited you to "+project.name+"."},"project-invitation:"+id);
    db.prepare("INSERT INTO notification_context VALUES(?,?,?,?)").run(notification.id,"project_invite",projectId,id);
    return {id,status:"pending",username:target.username};
  });
}
export function respondProjectInvitation(id:string,userId:string,action:"accept"|"decline") {
  return transaction(()=>{
    const db=getDatabase();
    const invitation=db.prepare("SELECT * FROM project_invitations WHERE id=? AND invitee_id=?").get(id,userId) as Invitation|undefined;
    if(!invitation) throw new ProjectSharingError("Invitation not found",404);
    const status=action==="accept" ? "accepted" : "declined";
    if(invitation.status!== "pending" && invitation.status!==status) throw new ProjectSharingError("This invitation is no longer pending.",409);
    if(invitation.status==="pending") {
      if(projectRole(invitation.project_id,invitation.inviter_id)!=="owner") throw new ProjectSharingError("This invitation is no longer available.",409);
      const now=new Date().toISOString();
      db.prepare("UPDATE project_invitations SET status=?,responded_at=? WHERE id=? AND status='pending'").run(status,now,id);
      if(action==="accept") db.prepare("INSERT OR IGNORE INTO project_members VALUES(?,?,?)").run(invitation.project_id,userId,now);
      db.prepare(`INSERT OR IGNORE INTO notification_reads SELECT n.id,?,? FROM notification_records n JOIN notification_context c ON c.notification_id=n.id WHERE n.owner_id=? AND c.invitation_id=?`).run(userId,now,userId,id);
      const recipient=db.prepare("SELECT username FROM users WHERE id=?").get(userId) as {username:string};
      const project=db.prepare("SELECT json_extract(data,'$.name') AS name FROM projects WHERE id=?").get(invitation.project_id) as {name:string};
      const notice=createNotification(invitation.inviter_id,{title:action==="accept" ? "Invitation accepted" : "Invitation declined",body:recipient.username+(action==="accept" ? " joined " : " declined the invitation to ")+project.name+"."},"project-response:"+id);
      db.prepare("INSERT INTO notification_context VALUES(?,?,?,NULL)").run(notice.id,"notice",invitation.project_id);
    }
    return {projectId:invitation.project_id,status};
  });
}
export function removeProjectMember(projectId:string,userId:string,input:{userId?:string;invitationId?:string}) {
  const role=requireAccess(projectId,userId);
  return transaction(()=>{
    const db=getDatabase();
    if(input.invitationId) {
      if(role!=="owner") throw new ProjectSharingError("Only the project owner can cancel invitations.",403);
      db.prepare("UPDATE project_invitations SET status='revoked',responded_at=? WHERE id=? AND project_id=? AND status='pending'").run(new Date().toISOString(),input.invitationId,projectId);
    } else if(input.userId) {
      if(input.userId!==userId && role!=="owner") throw new ProjectSharingError("Only the project owner can remove members.",403);
      if(projectRole(projectId,input.userId)==="owner") throw new ProjectSharingError("The project owner cannot leave their project.");
      // No preference or provider credentials are transferred to the remaining members.
      db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(projectId,input.userId);
      db.prepare("UPDATE project_invitations SET status=\'revoked\',responded_at=? WHERE project_id=? AND invitee_id=? AND status IN (\'pending\',\'accepted\')").run(new Date().toISOString(),projectId,input.userId);
    } else throw new ProjectSharingError("Choose a member or pending invitation.");
    return {ok:true};
  });
}
export function notificationInbox(userId:string) {
  const db=notificationDatabase();
  // Routine run completions belong to the delivery feed, not the account inbox.
  // Filter before LIMIT and use the same rule for the unread badge, including history.
  const visible="instr(COALESCE(n.source_key,''),'run:' || n.owner_id || ':done:') != 1";
  const notifications=db.prepare(`SELECT n.id,n.title,n.body,n.chat_id AS chatId,n.created_at AS createdAt,r.read_at AS readAt,
    COALESCE(c.kind,'notice') AS kind,c.project_id AS projectId,c.invitation_id AS invitationId,i.status AS invitationStatus
    FROM notification_records n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=n.owner_id
    LEFT JOIN notification_context c ON c.notification_id=n.id LEFT JOIN project_invitations i ON i.id=c.invitation_id
    WHERE n.owner_id=? AND ${visible} ORDER BY CASE WHEN i.status=\'pending\' THEN 0 ELSE 1 END,n.sequence DESC LIMIT 100`).all(userId);
  const unreadCount=(db.prepare(`SELECT COUNT(*) AS count FROM notification_records n WHERE n.owner_id=? AND ${visible} AND NOT EXISTS(SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=?)`).get(userId,userId) as {count:number}).count;
  return {notifications,unreadCount};
}
export function markNotificationsRead(userId:string,ids:string[]|null) {
  const db=notificationDatabase();
  const now=new Date().toISOString();
  return transaction(()=>{
    if(ids===null) db.prepare("INSERT OR IGNORE INTO notification_reads SELECT id,owner_id,? FROM notification_records WHERE owner_id=?").run(now,userId);
    else {
      const insert=db.prepare("INSERT OR IGNORE INTO notification_reads SELECT id,owner_id,? FROM notification_records WHERE owner_id=? AND id=?");
      for(const id of ids.slice(0,100)) insert.run(now,userId,id);
    }
    return {ok:true};
  });
}
