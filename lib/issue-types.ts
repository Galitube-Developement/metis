/** Shared, browser-safe issue contracts. Project IDs are the existing Metis projects. */
export const ISSUE_STATUSES = ["in_progress", "todo", "backlog", "done", "canceled"] as const;
export const ISSUE_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type IssueStatus = typeof ISSUE_STATUSES[number];
export type IssuePriority = typeof ISSUE_PRIORITIES[number];
export const ISSUE_STATUS_LABELS: Record<IssueStatus,string> = {backlog:"Backlog",todo:"Todo",in_progress:"In progress",done:"Done",canceled:"Canceled"};
export const ISSUE_PRIORITY_LABELS: Record<IssuePriority,string> = {none:"No priority",low:"Low",medium:"Medium",high:"High",urgent:"Urgent"};
export type IssueSource = {noteId:string;sourceId:string;kind:"selection"|"checkbox";excerpt?:string};
export type Issue = {
  id:string;key:string;projectId:string|null;ownerId:string;creatorId:string;title:string;description:string;
  status:IssueStatus;priority:IssuePriority;labels:string[];assigneeId:string|null;dueDate:string|null;
  parentId:string|null;source:IssueSource|null;createdAt:string;updatedAt:string;version:number;
  issuebookId?:string;noteId?:string;
};
export type IssueRelation = {id:string;issueId:string;targetId:string;kind:"related"|"blocks";createdAt:string};
export type IssueComment = {id:string;issueId:string;authorId:string;authorName:string;body:string;createdAt:string};
export type IssueActivity = {id:string;issueId:string;actorId:string;actorName:string;action:string;changes:Record<string,{before:unknown;after:unknown}>;createdAt:string};
export type IssueMember = {userId:string;username:string;displayName?:string;role?:string};
export type IssueFilters = {search:string;status:string;priority:string;assignee:string;label:string;sort:"updated"|"created"|"priority"|"due";mine:boolean};
export type IssueSavedView = {id:string;name:string;filters:IssueFilters};
export type IssueViewSettings = {layout:"list"|"board";filters:IssueFilters;savedViews:IssueSavedView[]};
export const DEFAULT_ISSUE_FILTERS:IssueFilters = {search:"",status:"all",priority:"all",assignee:"all",label:"all",sort:"updated",mine:false};
export type IssueWriteInput = Partial<Pick<Issue,"title"|"description"|"status"|"priority"|"labels"|"assigneeId"|"dueDate"|"parentId">> & {projectId?:string|null;issuebookId?:string;source?:IssueSource|null;expectedVersion?:number};
export type IssueDetail = {issue:Issue;comments:IssueComment[];history:IssueActivity[];relations:IssueRelation[];subissues:Issue[]};
export type IssueListResponse = {issues:Issue[];currentUserId:string;members:IssueMember[];settings:IssueViewSettings};
/** The picker and run-context resolver use this canonical snapshot shape. */
export function issueReference(issue:Issue,projectName?:string) {
  const project=projectName||(issue.projectId?"Project "+issue.projectId:"No Project");
  return {
    kind:"issue" as const,id:issue.id,label:issue.key+" · "+issue.title,
    detail:project+" · "+ISSUE_STATUS_LABELS[issue.status]+" · "+ISSUE_PRIORITY_LABELS[issue.priority],
    path:"issue://"+issue.id,
    content:[
      "Issue: "+issue.key,"ID: "+issue.id,"Project: "+(issue.projectId||"No Project"),
      "Status: "+ISSUE_STATUS_LABELS[issue.status],"Priority: "+ISSUE_PRIORITY_LABELS[issue.priority],
      "Assignee: "+(issue.assigneeId||"Unassigned"),"Labels: "+(issue.labels.join(", ")||"None"),
      "Due date: "+(issue.dueDate||"None"),"",issue.description.slice(0,6000),
    ].join("\n"),
  };
}
export async function createIssueFromPage(input:IssueWriteInput & {title:string;source:IssueSource}):Promise<Issue> {
  const response = await fetch("/api/issues",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not create issue.");
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("metis-issues-changed",{detail:{projectId:body.issue.projectId,noteId:input.source.noteId}}));
  return body.issue;
}
