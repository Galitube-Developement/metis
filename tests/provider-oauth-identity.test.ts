import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import ts from "typescript";
import test, { after } from "node:test";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-oauth-identity-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,AI_CHAT_SECRETS_KEY:"ab".repeat(32)});
after(()=>rmSync(root,{recursive:true,force:true}));
test("OAuth start creates separate accounts and reconnects only an explicit owned ID",async()=>{
 const [auth,connections,flows,{getDatabase}]=await Promise.all([import("../lib/auth"),import("../lib/provider-connections"),import("../lib/oauth-flows"),import("../lib/sqlite")]);
 const owner=randomUUID(),foreign=randomUUID(),token=randomUUID(),stamp=new Date().toISOString(),db=getDatabase();
 for(const id of [owner,foreign])db.prepare("INSERT INTO users(id,username,password_hash,created_at)VALUES(?,?,?,?)").run(id,id,"unused",stamp);
 db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at)VALUES(?,?,?)").run(createHash("sha256").update(token).digest("hex"),owner,"2099-01-01T00:00:00.000Z");
 const source=ts.createSourceFile("route.ts",readFileSync("app/api/providers/oauth/start/route.ts","utf8"),ts.ScriptTarget.Latest,true);
 const post=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="POST")!;
 const js=ts.transpileModule(post.getText(source).replace("export async function","async function"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const started:unknown[]=[];
 const POST=vm.runInNewContext(js+";POST",{
  ...auth,...connections,...flows,Response,OAUTH_PROVIDERS:new Set(["codex","claude-code","antigravity"]),
  runOAuthFlow:async(value:unknown)=>{started.push(value);},
 }) as (request:Request)=>Promise<Response>;
 const request=(body:unknown)=>new Request("http://fixture/api/providers/oauth/start",{method:"POST",headers:{cookie:"ai_chat_auth="+token,"content-type":"application/json"},body:JSON.stringify(body)});
 const body={providerKey:"codex",slug:"codex-main",label:"Codex",config:{project:"keep"}};
 const a=await POST(request(body)),b=await POST(request({...body,id:""}));
 assert.equal(a.status,202);assert.equal(b.status,202);
 const first=(await a.json()).flow.connectionId,second=(await b.json()).flow.connectionId;
 assert.notEqual(first,second);
 assert.equal(connections.getProviderConnection(first,owner)?.slug,"codex-main");
 assert.equal(connections.getProviderConnection(second,owner)?.slug,"codex-main-2");
 const reconnect=await POST(request({...body,id:first,label:"Renamed",slug:"another-slug",config:{location:"keep-too"}}));
 assert.equal(reconnect.status,202);assert.equal((await reconnect.json()).flow.connectionId,first);
 const saved=connections.getProviderConnection(first,owner)!;
 assert.equal(saved.slug,"codex-main");assert.equal(saved.label,"Renamed");
 assert.equal(saved.config.project,"keep");assert.equal(saved.config.location,"keep-too");
 const other=connections.upsertProviderConnection(foreign,{providerKey:"codex",slug:"codex-main",label:"Foreign",authType:"oauth"})!;
 for(const patch of [{id:other.id},{id:randomUUID()},{id:first,providerKey:"claude-code"}]){
  assert.equal((await POST(request({...body,...patch}))).status,404);
 }
 assert.equal(started.length,3,"rejected IDs must not launch an OAuth login");
 assert.equal(connections.getProviderConnection(other.id,foreign)?.label,"Foreign");
});
