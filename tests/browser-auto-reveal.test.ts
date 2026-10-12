import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {canAutoRevealBrowser,WORKSPACE_BROWSER_IDLE_MS} from "../lib/browser-auto-reveal";

const source=fs.readFileSync(new URL("../components/app-shell.tsx",import.meta.url),"utf8");
const tree=ts.createSourceFile("app-shell.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(predicate:(node:ts.Node)=>boolean){let result:ts.Node|undefined;function walk(node:ts.Node){if(!result&&predicate(node))result=node;ts.forEachChild(node,walk);}walk(tree);assert.ok(result);return result!;}
function evaluate(fn:ts.Node,context:Record<string,unknown>){
 const js=ts.transpileModule("const callback="+fn.getText(tree)+";",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return new Function(...Object.keys(context),js+";return callback;")(...Object.values(context));
}
const browserEffect=find(node=>ts.isCallExpression(node)&&node.expression.getText(tree)==="useEffect"&&node.arguments[0]?.getText(tree).includes("/api/browser/live?")) as ts.CallExpression;
function harness(options:{now?:number;last?:number;open?:boolean;mobile?:boolean;active?:boolean;blocked?:boolean;hidden?:boolean;otherChat?:boolean}={}){
 const changes:string[]=[],clock={now:options.now??WORKSPACE_BROWSER_IDLE_MS},last={current:options.last??0};
 const state={current:{workspaceOpen:options.open??false,activeRun:options.active??true,blocked:options.blocked??false}};
 let stream:{onmessage?:(event:{data:string})=>void}|undefined;
 const pointer={current:null as number|null};
 const callback=evaluate(browserEffect.arguments[0],{
  window:{setTimeout:()=>1,clearTimeout:()=>{}},document:{visibilityState:options.hidden?"hidden":"visible"},
  browserEnabled:true,activeChatId:"chat-1",activeChatIdRef:{current:options.otherChat?"chat-2":"chat-1"},
  browserAutoRevealStateRef:state,lastWorkspaceInteractionAtRef:last,canAutoRevealBrowser,
  isMobileChatViewport:()=>options.mobile??false,
  setWorkspaceMounted:(v:boolean)=>changes.push("mounted:"+v),
  setWorkspaceOpen:(v:boolean)=>changes.push("open:"+v),
  setWorkspaceTab:(v:string)=>changes.push("tab:"+v),
  setAgentPointer:()=>{},agentPointerHideTimerRef:pointer,
  setActiveBrowserTabId:()=>{},activeBrowserTabIdRef:{current:"tab-1"},
  setBrowserHistory:()=>{},fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({history:[]})}),
  Date:{now:()=>clock.now},
  EventSource:function(){const next={onmessage:undefined as ((event:{data:string})=>void)|undefined,close(){}};stream=next;return next;},
 });
 const cleanup=callback();
 return {changes,clock,last,state,cleanup,emit:(type:string,origin="agent")=>stream!.onmessage!({data:JSON.stringify({type,source:origin,x:0.5,y:0.5,action:"click",tabId:"tab-2"})})};
}
test("three-minute boundary, open workspace and invalid clocks",()=>{
 const args={workspaceOpen:false,lastWorkspaceInteractionAt:1000,now:181000,mobile:false,activeRun:true,blocked:false};
 assert.equal(WORKSPACE_BROWSER_IDLE_MS,180000);
 assert.equal(canAutoRevealBrowser({...args,now:180999}),false);
 assert.equal(canAutoRevealBrowser(args),true);
 assert.equal(canAutoRevealBrowser({...args,workspaceOpen:true}),false);
 assert.equal(canAutoRevealBrowser({...args,now:999}),false);
 assert.equal(canAutoRevealBrowser({...args,lastWorkspaceInteractionAt:NaN}),false);
});
for(const type of ["pointer","action","navigation"]) test("actual SSE "+type+" respects inactivity and reveals only the collapsed pane",()=>{
 const fresh=harness({now:179999});fresh.emit(type);assert.deepEqual(fresh.changes,[]);
 const eligible=harness();eligible.emit(type);
 assert.deepEqual(eligible.changes,["mounted:true","tab:browser","open:true"]);
 eligible.emit(type);assert.equal(eligible.changes.length,3,"later events must not switch an already open workspace");
 for(const options of [{open:true},{last:1},{mobile:true},{active:false},{blocked:true},{hidden:true},{otherChat:true}]){
  const blocked=harness(options);blocked.emit(type);assert.deepEqual(blocked.changes,[],JSON.stringify(options));
 }
 const user=harness();user.emit(type,"user");assert.deepEqual(user.changes,[]);
});
test("workspace captures real pointer, typing and wheel activity without React state writes",()=>{
 const declaration=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==="markWorkspaceInteraction") as ts.VariableDeclaration;
 const fn=(declaration.initializer as ts.CallExpression).arguments[0];
 const last={current:0};let now=500;
 const record=evaluate(fn,{lastWorkspaceInteractionAtRef:last,Date:{now:()=>now}});
 record({nativeEvent:{isTrusted:true}});assert.equal(last.current,500);
 now=1000;record({nativeEvent:{isTrusted:false}});assert.equal(last.current,500,"agent/programmatic events must not count as user activity");
 const aside=find(n=>ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==="aside"&&n.attributes.getText(tree).includes("workspace-surface")) as ts.JsxOpeningElement;
 for(const name of ["onPointerDownCapture","onPointerMoveCapture","onKeyDownCapture","onInputCapture","onWheelCapture"]){
  const attr=aside.attributes.properties.find(n=>ts.isJsxAttribute(n)&&n.name.getText(tree)===name) as ts.JsxAttribute;
  assert.ok(attr);assert.equal((attr.initializer as ts.JsxExpression).expression?.getText(tree),"markWorkspaceInteraction");
 }
});
test("collapsing a previously idle workspace restarts the three-minute cooldown",()=>{
 const effect=find(n=>ts.isCallExpression(n)&&n.expression.getText(tree)==="useEffect"&&n.arguments[0]?.getText(tree).includes("workspaceWasOpenRef.current")) as ts.CallExpression;
 const last={current:0},wasOpen={current:true},now=400000;
 evaluate(effect.arguments[0],{workspaceWasOpenRef:wasOpen,workspaceOpen:false,lastWorkspaceInteractionAtRef:last,Date:{now:()=>now}})();
 assert.equal(last.current,now);assert.equal(wasOpen.current,false);
 assert.equal(canAutoRevealBrowser({workspaceOpen:false,lastWorkspaceInteractionAt:last.current,now:now+179999,mobile:false,activeRun:true,blocked:false}),false);
});
test("explicitly opening a link still works immediately during cooldown",()=>{
 const declaration=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(tree)==="openLinkedUrl") as ts.VariableDeclaration;
 const changes:string[]=[];
 evaluate(declaration.initializer!,{browserEnabled:true,setWorkspaceTab:(v:string)=>changes.push(v),setWorkspaceOpen:(v:boolean)=>changes.push(String(v)),openBrowserTabRef:{current:(v:string)=>changes.push(v)}})({detail:"https://example.com/"});
 assert.deepEqual(changes,["browser","true","https://example.com/"]);
});
