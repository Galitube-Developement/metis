import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
async function main() {
 const root=process.cwd(), fixture=path.join(root,'fixture');
 const { config }=await import('./lib/config');
 assert.equal(config.databasePath,path.join(fixture,'data/chat.sqlite'));
 // Prevent enumeration of real host accounts. Only this synthetic passwd is visible.
 const actualReadFileSync=fs.readFileSync;
 fs.readFileSync=((file:any,...args:any[])=>String(file)==='/etc/passwd'
  ? 'root:x:0:0:synthetic root:/root:/bin/bash\nsynthetic_os_account:x:12345:12345:synthetic:/home/synthetic_os_account:/bin/bash\n'
  : (actualReadFileSync as any)(file,...args)) as any;
 syncBuiltinESMExports();
 const setup=await import('./app/api/setup/route');
 const preSetup=await setup.GET(new Request('http://audit.invalid/api/setup'));
 const preBody=await preSetup.json();
 assert.ok(preBody.osUsers.some((u:any)=>u.username==='synthetic_os_account' && u.home==='/home/synthetic_os_account'));
 console.log('MA05_PREAUTH_SYNTHETIC_OS_ACCOUNT_DISCLOSED');
 const auth=await import('./lib/auth');
 const users=await import('./lib/admin-users');
 const access=await import('./lib/user-access');
 const routes=await import('./app/api/auth/route');
 const request=(url:string,body:any,headers:any={})=>new Request('http://audit.invalid'+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const initial=await setup.POST(request('/api/setup',{action:'bootstrap',username:'audit_admin',password:'synthetic-password-123'}));
 assert.equal(initial.status,201);
 const a=(await initial.json()).user;
 assert.equal(a.isAdmin,true);
 assert.equal((await setup.POST(request('/api/setup',{action:'bootstrap',username:'audit_other',password:'synthetic-password-123'}))).status,409);
 console.log('MA01_ROUTE_BOOTSTRAP_201_SECOND_409');
 const postSetup=await setup.GET(new Request('http://audit.invalid/api/setup'));
 assert.deepEqual((await postSetup.json()).osUsers,[]);
 console.log('MA05_AFTER_FIRST_USER_ANON_OS_LIST_EMPTY');
 const b=users.createManagedUser({username:'audit_secondary',password:'synthetic-password-456'});
 assert.equal(b.isAdmin,false); assert.equal(b.workspaceRoot,a.workspaceRoot);
 const identity=access.requireUserExecutionIdentity(b.id);
 assert.equal(identity.uid,0);
 assert.equal(access.getUserAccess(b.id).osUsername,'root');
 console.log('MA03_SECONDARY_NONADMIN_ROOT_SHARED_WORKSPACE');
 const marker=path.join(fixture,'workspace/.ai-chat-uploads/artificial-owner-a/marker.txt');
 mkdirSync(path.dirname(marker),{recursive:true}); writeFileSync(marker,'ARTIFICIAL_OWNER_A_PRIVATE_MARKER\n',{mode:0o600});
 const outside=path.join(fixture,'data/outside-workspace.txt'); writeFileSync(outside,'ARTIFICIAL_OUTSIDE_WORKSPACE_MARKER\n',{mode:0o600});
 const {getMcpServers}=await import('./lib/mcp');
 const {trustedSessionContextFromBearer}=await import('./lib/mcp-core/http-auth.mjs');
 const servers=getMcpServers({userId:b.id,runtimeMode:'agent'});
 const token=(servers.gateway as any).headers.Authorization.replace(/^Bearer /,'');
 const context=trustedSessionContextFromBearer(token,process.env.MCP_BEARER_TOKEN)!;
 assert.equal(context.userId,b.id); assert.equal(context.uid,0);
 assert.ok(context); assert.equal(context.isHostAdmin,false);
 const {dispatchGatewayTool}=await import('./lib/mcp-core/gateway-core.mjs');
 const call=async(name:string,args:any)=>dispatchGatewayTool(name,args,{context,auditCall:false});
 const text=(r:any)=>r.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n') || '';
 const read=await call('read_file',{path:marker});
 assert.ok(!read.isError,text(read)); assert.match(text(read),/ARTIFICIAL_OWNER_A_PRIVATE_MARKER/);
 console.log('MA03_SIGNED_NONADMIN_MCP_CROSS_USER_FILE_READ');
 const direct=await call('read_file',{path:outside});
 assert.equal(direct.isError,true); assert.match(text(direct),/inside the agent workspace/);
 console.log('MA03_DIRECT_OUTSIDE_PATH_REJECTED');
 const shell=await call('execute_command',{cwd:identity.workspaceRoot,command:"id -u; cat '"+outside+"'",timeout:5});
 assert.ok(!shell.isError,text(shell));
 const result=JSON.parse(text(shell)); assert.equal(result.exit_code,0); assert.match(result.stdout,/^0\n/); assert.match(result.stdout,/ARTIFICIAL_OUTSIDE_WORKSPACE_MARKER/);
 console.log('MA03_SIGNED_NONADMIN_SHELL_UID0_OUTSIDE_SENTINEL_READ');
 for(let i=0;i<11;i++) {const r=await routes.POST(request('/api/auth',{username:b.username,password:'wrong'},{'x-real-ip':'192.0.2.1'}));assert.equal(r.status,i<10?401:429);}
 for(let i=0;i<12;i++) {const r=await routes.POST(request('/api/auth',{username:b.username,password:'wrong'},{'x-real-ip':'198.51.100.'+(i+1)}));assert.equal(r.status,401);}
 console.log('MA02_CONSTANT_10X401_429_ROTATING_12X401');
 const login=auth.authenticateUser(b.username,'synthetic-password-456')!;
 const oldRequest=new Request('http://audit.invalid/api/chats',{headers:{cookie:'ai_chat_auth='+login.token}});
 assert.equal(await auth.getAuthenticatedUserId(oldRequest),b.id);
 await routes.DELETE(oldRequest);
 assert.equal(await auth.getAuthenticatedUserId(oldRequest),b.id);
 const second=auth.authenticateUser(b.username,'synthetic-password-456')!;
 assert.notEqual(login.token,second.token);
 console.log('MAH3_LOGOUT_OLD_COOKIE_VALID_LOGIN_NEW_RANDOM_TOKEN');
 let calls=0;
 const stub=http.createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer synthetic-provider-key');req.resume();res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'synthetic provider refuses generation',type:'invalid_request_error'}}));});
 await new Promise<void>(resolve=>stub.listen(0,'127.0.0.1',resolve));
 const port=(stub.address() as any).port;
 process.env.OPENAI_API_KEY='synthetic-provider-key';process.env.OPENAI_MODEL='audit-model';process.env.OPENAI_BASE_URL='http://127.0.0.1:'+port+'/v1';
 const originalFetch=globalThis.fetch;
 globalThis.fetch=((url:any,init:any)=>{const u=new URL(typeof url==='string'?url:url.url || String(url));assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,String(port));return originalFetch(url,init);}) as any;
 try {
  const processRoute=await import('./app/api/process-a/route');
  const response=await processRoute.POST(request('/api/process-a',{topic:'synthetic audit',languages:['en']}));
  assert.equal(response.status,500);assert.equal(calls,1);
  console.log('MA04_UNAUTH_ROUTE_LOCAL_PROVIDER_CALLED_ONCE_NO_REAL_BILLING');
 } finally {globalThis.fetch=originalFetch;await new Promise<void>(resolve=>stub.close(()=>resolve()));}
 const {getDatabase}=await import('./lib/sqlite');
 getDatabase().close();
 console.log('AUDIT_RECHECK_PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
