/** Canonical gateway schemas. No provider-native issue tools or separate project IDs. */
const project={type:"string",description:"Existing Metis Project ID, or 'none' for this account's private No Project issues. Always choose explicitly."};
const id={type:"string",description:"Issue UUID returned by create_issue/list_issues."};
const fields={
  title:{type:"string",minLength:1,maxLength:300},
  description:{type:"string",maxLength:100000,description:"Markdown description."},
  status:{type:"string",enum:["backlog","todo","in_progress","done","canceled"]},
  priority:{type:"string",enum:["none","low","medium","high","urgent"]},
  labels:{type:"array",items:{type:"string",maxLength:60},maxItems:30},
  assigneeId:{type:["string","null"],description:"Current project member ID, or null to clear. In No Project only the current account can be assigned."},
  dueDate:{type:["string","null"],description:"YYYY-MM-DD, or null to clear."},
  parentId:{type:["string","null"],description:"Parent issue in the same project, or null to clear."},
};
function tool(name,description,properties,required,readOnlyHint=false) {
  return {name,description,inputSchema:{type:"object",properties:{projectId:project,...properties},required:["projectId",...required],additionalProperties:false},annotations:{readOnlyHint}};
}
export const ISSUE_ACTIONS={list_issues:"list",get_issue:"get",create_issue:"create",update_issue:"update",delete_issue:"delete",add_issue_comment:"comment",link_issues:"link"};
export const ISSUE_TOOL_CATEGORIES=Object.entries(ISSUE_ACTIONS).map(([name,action])=>[name,["list","get"].includes(action)?"read":"write"]);
export const ISSUE_TOOLS=[
  tool("list_issues","List or search persisted issues in an explicitly chosen existing Metis Project or 'none'. Includes current project members for valid assignment. Does not start agents.",{
    search:{type:"string"},status:fields.status,assigneeId:{type:"string"},noteId:{type:"string",description:"Limit to issues converted from this page."}
  },[],true),
  tool("get_issue","Read issue properties, source page, subissues, relations, comments and change history in the explicitly selected project.",{id},["id"],true),
  tool("create_issue","Create a persisted issue in an existing Metis Project or private 'none'. Page source IDs make checkbox/selection conversion idempotent. Never creates a separate project or starts agents.",{
    ...fields,
    source:{type:"object",properties:{noteId:{type:"string"},sourceId:{type:"string",description:"Stable source block/checkbox/selection ID from the page."},kind:{type:"string",enum:["selection","checkbox"]},excerpt:{type:"string",maxLength:4000}},required:["noteId","sourceId","kind"],additionalProperties:false},
    idempotencyKey:{type:"string",maxLength:240},
  },["title"]),
  tool("update_issue","Update an issue in the explicitly selected project. Use expectedVersion from get_issue to prevent overwriting concurrent edits.",{id,...fields,expectedVersion:{type:"integer",minimum:1}},["id"]),
  tool("delete_issue","Permanently delete an issue, comments and relations. Subissues are preserved. Use only when the user requests issue deletion.",{id},["id"]),
  tool("add_issue_comment","Add a comment to an issue in the explicitly selected project.",{id,body:{type:"string",minLength:1,maxLength:20000}},["id","body"]),
  tool("link_issues","Link two issues in the same explicitly selected project. Blocks relations reject cycles.",{id,targetId:id,kind:{type:"string",enum:["related","blocks"]}},["id","targetId","kind"]),
];
