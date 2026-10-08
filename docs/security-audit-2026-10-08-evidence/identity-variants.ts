import assert from 'node:assert/strict';
import os from 'node:os';
async function main(){
 const variant=process.argv[2];
 if(variant==='simulated-nonroot'){
  Object.defineProperty(process,'getuid',{value:()=>12345});
  Object.defineProperty(os,'userInfo',{value:()=>({username:'synthetic_host_user',uid:12345,gid:12345,homedir:'/tmp/synthetic_host_home',shell:'/bin/bash'})});
 }
 const {createManagedUser}=await import('./lib/admin-users');
 const {requireUserExecutionIdentity}=await import('./lib/user-access');
 const {config}=await import('./lib/config');
 const {getDatabase}=await import('./lib/sqlite');
 let a,b;
 if(variant==='docker-contract'){
  const db=getDatabase();
  for(const id of ['artificial-a','artificial-b']){
   db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)").run(id,id,'synthetic-unused-hash',new Date().toISOString(),id==='artificial-a'?1:0);
   db.prepare("INSERT INTO user_workspace_access(user_id,workspace_root,created_at,updated_at) VALUES(?,?,?,?)").run(id,'/workspace',new Date().toISOString(),new Date().toISOString());
  }
  a={id:'artificial-a'};b={id:'artificial-b'};
 }else{
  a=createManagedUser({username:'synthetic_admin',password:'synthetic-password-123'});
  b=createManagedUser({username:'synthetic_secondary',password:'synthetic-password-456'});
 }
 if(variant==='disabled-root'){
  assert.equal(config.allowRootAgents,false);
  assert.throws(()=>requireUserExecutionIdentity(b.id),/no valid OS user mapping/);
  console.log('MA03_ROOT_DISABLED_FAIL_CLOSED');
 }else{
  const x=requireUserExecutionIdentity(a.id),y=requireUserExecutionIdentity(b.id);
  assert.equal(x.uid,y.uid);assert.equal(x.workspaceRoot,y.workspaceRoot);
  if(variant==='simulated-nonroot'){assert.equal(y.uid,12345);console.log('MA03_SIMULATED_NONROOT_SECONDARY_INFERRED_SHARED_UID');}
  else{assert.equal(config.docker,true);console.log('MA03_DOCKER_CONTRACT_SHARED_PROCESS_UID_WORKSPACE');}
 }
 getDatabase().close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
