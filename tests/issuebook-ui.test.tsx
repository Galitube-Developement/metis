import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueRow } from "../components/notes/issue-row";
import { IssueStatusMenu } from "../components/notes/issue-controls";
import { ISSUE_STATUSES, ISSUE_STATUS_LABELS, type Issue } from "../lib/issue-types";
Object.assign(globalThis,{React});
const issue:Issue={id:"id",key:"QA-1",projectId:null,ownerId:"owner",creatorId:"owner",title:"Keep <draft> safe",description:"body",status:"todo",priority:"high",labels:["Design"],assigneeId:"owner",dueDate:"2026-01-01",parentId:null,source:null,createdAt:"2026-01-01",updatedAt:"2026-01-01",version:3};
const props={issue,busy:false,selecting:false,selected:false,assigneeName:"Alex",onSelect(){},onOpen(){},onDetails(){},onUpdate(){}};
test("default issue row separates opening, status, priority and details without selection clutter",()=>{
 const html=renderToStaticMarkup(<IssueRow {...props}/>);
 assert.equal((html.match(/aria-label="Change status for QA-1:/g)||[]).length,1);
 assert.match(html,/aria-label="Change priority for QA-1: High"/);
 assert.match(html,/aria-label="More actions for QA-1"/);
 assert.doesNotMatch(html,/<select|type="checkbox"/);
 assert.match(html,/Keep &lt;draft&gt; safe/);
 assert.match(html,/Assigned to Alex/);assert.match(html,/Overdue/);
});
test("selection is an explicit mode with an independently named checked control",()=>{
 const html=renderToStaticMarkup(<IssueRow {...props} selecting selected/>);
 assert.match(html,/type="checkbox"/);assert.match(html,/aria-label="Select QA-1"/);assert.match(html,/checked=""/);
 assert.match(html,/Change status for QA-1: Todo/);
});
test("board keeps a focusable status menu as the non-drag movement alternative",()=>{
 const html=renderToStaticMarkup(<IssueRow {...props} board/>);
 assert.match(html,/draggable="true"/);assert.match(html,/aria-haspopup="menu"/);
 assert.match(html,/Change status for QA-1/);
 const selecting=renderToStaticMarkup(<IssueRow {...props} board selecting/>);
 assert.match(selecting,/draggable="false"/);
});
test("busy rows disable mutations and all five statuses retain readable names",()=>{
 const html=renderToStaticMarkup(<IssueRow {...props} busy selecting/>);
 assert.equal((html.match(/disabled=""/g)||[]).length,4);
 for(const status of ISSUE_STATUSES){
  const markup=renderToStaticMarkup(<IssueStatusMenu status={status} issueKey="QA-2" showLabel onChange={()=>{}}/>);
  assert.ok(markup.includes("QA-2: "+ISSUE_STATUS_LABELS[status]));
  assert.ok(markup.includes(">"+ISSUE_STATUS_LABELS[status]+"<"));
 }
});
