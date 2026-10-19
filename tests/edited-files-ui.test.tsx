import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerEditedFiles, EditedFiles } from "../components/edited-files";
import { activeEditedFilesMessageId, editedFilesForMessage } from "../lib/edited-files";
import type { ToolPart } from "../lib/store";

Object.assign(globalThis, { React });

const tool: ToolPart = {
  id: "first", name: "edit_file", status: "completed",
  editedFile: {path: "/workspace/src/main.ts", target: "server", additions: 2, deletions: 1},
};
type Message = {
  id: string; role: string; streaming?: boolean; content?: string;
  tools?: ToolPart[]; errorMessage?: string; programEvent?: unknown; questionAnswer?: unknown;
};
const reply: Message = {id:"reply",role:"assistant",streaming:true,tools:[tool]};
function renderPlacement(messages: Message[], state: {running?: boolean; loading?: boolean} = {}) {
  const activeId=activeEditedFilesMessageId(messages,state);
  const active=messages.find(message=>message.id===activeId);
  return renderToStaticMarkup(<>
    <main>{messages.filter(message=>message.role==="assistant").map(message=><article key={message.id} data-message-id={message.id}>
      <EditedFiles files={editedFilesForMessage(message)} streaming={message.id===activeId}/>
    </article>)}</main>
    <footer>{active ? <ComposerEditedFiles key={active.id} files={editedFilesForMessage(active)}/> : null}<textarea aria-label="Message"/></footer>
  </>);
}
function assertLocations(html:string,composer:number,transcript:number) {
  assert.equal((html.match(/data-composer-edited-files=/g)||[]).length,composer);
  assert.equal((html.match(/data-edited-files=/g)||[]).length,transcript);
}

test("successful edits move from composer to the same reply at completion, even before busy clears",()=>{
  const live=renderPlacement([reply],{running:true});
  assertLocations(live,1,0);
  assert.match(live,/1 file edited/);
  assert.match(live,/aria-haspopup="dialog"/);
  const completed=renderPlacement([{...reply,streaming:false}],{running:true});
  assertLocations(completed,0,1);
  assert.match(completed,/data-message-id="reply"/);
  assert.match(completed,/Open \/workspace\/src\/main.ts/);
  assert.match(completed,/2 lines added/);
});

test("later tool calls stay at the composer until the turn ends and repeated edits stay one row",()=>{
  const messages=[{...reply,content:"Text already emitted",tools:[
    tool,{...tool,id:"again"},
    {...tool,id:"second",editedFile:{path:"/workspace/src/other.ts",target:"server"}},
    {...tool,id:"failed",status:"error"},
  ]}];
  const live=renderPlacement(messages,{running:true});
  assertLocations(live,1,0);
  assert.match(live,/2 files edited/);
  assertLocations(renderPlacement(messages.map(message=>({...message,streaming:false}))),0,1);
});

test("a new prompt or reply without edits never inherits the previous reply's files",()=>{
  const history={...reply,streaming:false};
  const prompt:Message={id:"next-user",role:"user"};
  assertLocations(renderPlacement([history,prompt],{running:true}),0,1);
  assertLocations(renderPlacement([history,prompt,{id:"next-reply",role:"assistant",streaming:true}],{running:true}),0,1);
  const next={...reply,id:"next-reply",tools:[{...tool,editedFile:{path:"/workspace/new.ts",target:"server"}}]};
  assertLocations(renderPlacement([history,prompt,next],{running:true}),1,1);
});

test("stop and error preserve successful edits under the reply and clear the composer",()=>{
  for(const terminal of [
    {...reply,streaming:false},
    {...reply,streaming:false,errorMessage:"Run failed"},
    {...reply,errorMessage:"Run failed"},
  ])assertLocations(renderPlacement([terminal],{running:true}),0,1);
});

test("resumed server turns use the same placement and question answers do not create a new turn",()=>{
  const resumed={...reply,streaming:undefined};
  assertLocations(renderPlacement([resumed],{running:true}),1,0);
  assertLocations(renderPlacement([resumed]),0,1);
  assertLocations(renderPlacement([resumed,{id:"answer",role:"user",questionAnswer:{questionId:"q"}}],{running:true}),1,0);
  assertLocations(renderPlacement([reply,{id:"event",role:"assistant",programEvent:{}}],{running:true}),1,0);
});

test("loading or switching chats cannot keep a previous chat's composer file list",()=>{
  assertLocations(renderPlacement([reply],{running:true,loading:true}),0,1);
  assertLocations(renderPlacement([{...reply,streaming:false}],{running:false}),0,1);
  assertLocations(renderPlacement([], {running:true}),0,0);
});

test("runs without successful edits leave both locations clear",()=>{
  assert.equal(renderToStaticMarkup(<ComposerEditedFiles files={[]}/>),"");
  assertLocations(renderPlacement([{...reply,tools:[{...tool,status:"error"}]}],{running:true}),0,0);
});
