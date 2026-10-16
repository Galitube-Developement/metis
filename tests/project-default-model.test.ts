import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const directory = mkdtempSync(path.join(os.tmpdir(), "metis-project-model-"));
Object.assign(process.env, { CHAT_DATA_DIR: directory, CHAT_DB_PATH: path.join(directory, "chat.sqlite"), AI_CHAT_ROOT: directory, AGENT_CWD: directory, MCP_BEARER_TOKEN: "isolated-project-model" });
after(() => rmSync(directory, { recursive: true, force: true }));

test("optional project model governs model and params, while modes remain selectable", async t => {
  const [projects, store, team, jobs, auth, api, detail, chatApi, policy, sqlite, keys] = await Promise.all([
    import("../lib/projects"), import("../lib/db-store"), import("../lib/project-team"), import("../lib/db-jobs"),
    import("../lib/auth"), import("../app/api/projects/route"), import("../app/api/projects/[id]/route"),
    import("../app/api/chats/[id]/route"), import("../lib/project-model-server"), import("../lib/sqlite"), import("../lib/providers/types"),
  ]);
  const owner = auth.createUser("model-owner", "test-password").id;
  const stranger = auth.createUser("model-stranger", "test-password").id;
  const db = sqlite.getDatabase(), connection = "owned-models", foreign = "foreign-models";
  for (const [id, user] of [[connection, owner], [foreign, stranger]]) db.prepare("INSERT INTO provider_connections(id,owner_id,provider_key,slug,label,auth_type,config,enabled,created_at,updated_at) VALUES (?,?, 'openai',?,'Fixture','api_key','{}',1,datetime('now'),datetime('now'))").run(id,user,id);
  const parameters = [{ id: "effort", values: [{value:"low"},{value:"high"}] }, { id: "context", values: [{value:"32k"},{value:"64k"}] }];
  const metadata = JSON.stringify({ __parameters: parameters, __defaultParams: [{id:"effort",value:"low"}] });
  for (const id of [connection, foreign]) for (const model of ["first", "second"]) db.prepare("INSERT INTO provider_models(connection_id,canonical_id,display_name,capabilities,discovered_at) VALUES (?,?,?, ?,datetime('now'))").run(id,model,model,metadata);
  const first = keys.modelKey("openai", "first", connection), second = keys.modelKey("openai", "second", connection);
  const params = [{id:"context",value:"64k"},{id:"effort",value:"high"}];
  const cookie = "ai_chat_auth=" + auth.authenticateUser("model-owner","test-password")!.token;
  const req = (method:string, body?:unknown, url="http://test/api/projects") => new Request(url,{method,headers:{cookie,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let project: ReturnType<typeof projects.createProject>, agent: ReturnType<typeof team.createProjectAgent>;

  await t.test("defaults are opt-in and legacy mode data no longer forces a mode", () => {
    const legacy = projects.createProject({ownerId:owner,mode:"agents",defaultModeId:"plan"});
    assert.equal(legacy.defaultModelEnabled,false);
    db.prepare("UPDATE projects SET data=json_set(data,'$.defaultModeId','plan') WHERE id=?").run(legacy.id);
    const a=team.createProjectAgent({ownerId:owner,projectId:legacy.id,name:"Legacy",role:"Reviews"});
    store.updateChat(a.chatId,{sessionState:{modeId:"ask"}},owner);
    assert.equal(store.getChat(a.chatId,owner)?.sessionState?.modeId,"ask");
    const j=jobs.enqueueJob({chatId:a.chatId,userId:owner,message:"Question",modeId:"ask"});
    assert.equal(j.modeId,"ask");jobs.requestJobCancel(a.chatId,owner);
  });
  await t.test("create accepts only owned discovered models and advertised options", async () => {
    const r=await api.POST(req("POST",{mode:"agents",name:"Model team",defaultModelEnabled:true,defaultModelId:first,defaultModelParams:params}));
    assert.equal(r.status,201);project=(await r.json()).project;
    assert.equal(project.defaultModelId,first);assert.deepEqual(project.defaultModelParams,params);
    for (const bad of [
      {defaultModelEnabled:"true",defaultModelId:first}, {defaultModelEnabled:true},
      {defaultModelEnabled:true,defaultModelId:"openai:missing"},
      {defaultModelEnabled:true,defaultModelId:keys.modelKey("openai","first",foreign)},
      {defaultModelEnabled:true,defaultModelId:keys.modelKey("codex","first",connection)},
      {defaultModelEnabled:true,defaultModelId:first,defaultModelParams:[{id:"effort",value:"invented"}]},
      {defaultModelEnabled:true,defaultModelId:first,defaultModelParams:[{id:"temperature",value:"123"}]},
      {defaultModelEnabled:true,defaultModelId:first,defaultModelParams:[{id:"effort",value:"high"},{id:"effort",value:"low"}]},
      {defaultModelEnabled:true,defaultModelId:first,defaultModelParams:{}},
    ]) assert.equal((await api.POST(req("POST",{mode:"agents",...bad}))).status,400,JSON.stringify(bad));
    assert.equal(policy.projectModelOverride(project.id,stranger),null);
  });
  await t.test("new agents inherit model options; chat updates preserve drafts and free modes", async () => {
    agent=team.createProjectAgent({ownerId:owner,projectId:project.id,name:"Engineer",role:"Builds",modelId:second});
    let chat=store.getChat(agent.chatId,owner)!;assert.equal(chat.modelId,first);assert.deepEqual(chat.modelParams,params);
    const r=await chatApi.PATCH(req("PATCH",{modelId:second,modelParams:[],sessionState:{modeId:"ask",input:"Keep draft"}}),{params:Promise.resolve({id:agent.chatId})});
    assert.equal(r.status,200);chat=store.getChat(agent.chatId,owner)!;
    assert.equal(chat.modelId,first);assert.deepEqual(chat.modelParams,params);assert.equal(chat.sessionState?.modeId,"ask");assert.equal(chat.sessionState?.input,"Keep draft");
  });
  await t.test("queue and model-switch paths cannot override the project selection", async () => {
    const j=jobs.enqueueJob({chatId:agent.chatId,userId:owner,message:"Build",modeId:"plan",modelId:second,modelParams:[]});
    assert.equal(j.modelId,first);assert.deepEqual(j.modelParams,params);assert.equal(j.modeId,"plan");
    jobs.requestJobModelSwitch(agent.chatId,owner,second,[]);
    assert.equal(jobs.getJob(j.id)?.modelId,first);assert.deepEqual(jobs.getJob(j.id)?.modelParams,params);
    const claimed=jobs.claimNextJob({workerId:"model-test"})!;
    assert.equal(claimed.id,j.id);
    const modeApi=await import("../app/api/internal/mcp-mode/route");
    const r=await modeApi.POST(new Request("http://test/api/internal/mcp-mode",{method:"POST",headers:{authorization:"Bearer isolated-project-model","content-type":"application/json","x-ai-chat-job-id":claimed.id,"x-ai-chat-id":agent.chatId,"x-ai-chat-user-id":owner,"x-ai-chat-worker-id":claimed.leaseOwner!,"x-ai-chat-lease-token":claimed.leaseToken!},body:JSON.stringify({modeId:"agent"})}));
    assert.equal(r.status,200);assert.equal(store.getChat(agent.chatId,owner)?.sessionState?.modeId,"agent");
    jobs.requestJobCancel(agent.chatId,owner);
  });
  await t.test("hub updates existing chats and queued jobs without losing composer or preferences", async () => {
    store.saveGlobalModelSettings({...store.getGlobalModelSettings(owner),modelId:first,modelParams:params},owner);
    const j=jobs.enqueueJob({chatId:agent.chatId,userId:owner,message:"Queued",modelId:first});
    const r=await detail.PATCH(req("PATCH",{defaultModelId:second,defaultModelParams:[{id:"effort",value:"low"}]}),{params:Promise.resolve({id:project.id})});
    assert.equal(r.status,200);const chat=store.getChat(agent.chatId,owner)!;
    assert.equal(chat.modelId,second);assert.equal(chat.sessionState?.input,"Keep draft");assert.equal(jobs.getJob(j.id)?.modelId,second);
    assert.deepEqual(jobs.getJob(j.id)?.modelParams,[{id:"effort",value:"low"}]);assert.equal(store.getGlobalModelSettings(owner).modelId,first);
    jobs.requestJobCancel(agent.chatId,owner);
  });
  await t.test("disable restores individual selection, including when provider is unavailable", async () => {
    db.prepare("UPDATE provider_connections SET enabled=0 WHERE id=?").run(connection);
    const r=await detail.PATCH(req("PATCH",{defaultModelEnabled:false}),{params:Promise.resolve({id:project.id})});
    assert.equal(r.status,200);assert.equal(projects.getProject(project.id,owner)?.defaultModelEnabled,false);
    db.prepare("UPDATE provider_connections SET enabled=1 WHERE id=?").run(connection);
    store.updateChat(agent.chatId,{modelId:first,modelParams:params,sessionState:{modeId:"ask"}},owner);
    const j=jobs.enqueueJob({chatId:agent.chatId,userId:owner,message:"Free",modelId:first,modelParams:params,modeId:"ask"});
    assert.equal(j.modelId,first);assert.equal(j.modeId,"ask");assert.deepEqual(j.modelParams,params);jobs.requestJobCancel(agent.chatId,owner);
  });
  await t.test("model options are revalidated against refreshed discovery at enqueue time", () => {
    projects.updateProject(project.id,{defaultModelEnabled:true,defaultModelId:first,defaultModelParams:params},owner);
    db.prepare("UPDATE provider_models SET capabilities=? WHERE connection_id=? AND canonical_id=?").run(JSON.stringify({__parameters:[{id:"effort",values:[{value:"low"}]}]}),connection,"first");
    assert.throws(()=>jobs.enqueueJob({chatId:agent.chatId,userId:owner,message:"Stale options"}),/no longer supported/);
    db.prepare("UPDATE provider_models SET capabilities=? WHERE connection_id=? AND canonical_id=?").run(metadata,connection,"first");
    projects.updateProject(project.id,{defaultModelEnabled:false},owner);
  });
  await t.test("regular projects and foreign updates do not acquire model overrides", async () => {
    const regular=projects.createProject({ownerId:owner});
    assert.throws(()=>projects.updateProject(regular.id,{defaultModelEnabled:true,defaultModelId:first},owner),/only available/);
    assert.equal(projects.updateProject(project.id,{defaultModelEnabled:true,defaultModelId:first},stranger),null);
    assert.equal(projects.getProject(project.id,owner)?.defaultModelEnabled,false);
  });
});
