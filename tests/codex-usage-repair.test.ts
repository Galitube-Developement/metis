import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { repairCodexUsage } from "../scripts/repair-codex-usage";

test("repair is dry-run by default, account-scoped, backed up, idempotent and preserves live chat state", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(),"metis-usage-repair-"));
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE account_usage(owner_id TEXT,message_id TEXT,provider_id TEXT,completed_at TEXT,input_tokens INTEGER,output_tokens INTEGER,total_tokens INTEGER,cached_input_tokens INTEGER,cache_write_input_tokens INTEGER,PRIMARY KEY(owner_id,message_id)); CREATE TABLE chats(id TEXT,owner_id TEXT,data TEXT,updated_at TEXT);");
    const ownerId = "fixture-owner";
    const session = path.join(dataDir,"provider-sessions","codex",ownerId,"fixture-connection","sessions");
    mkdirSync(session,{recursive:true});
    const payload = (type: string, extra = {}) => JSON.stringify({timestamp:"2026-10-11T10:00:00Z",type:"event_msg",payload:{type,...extra}});
    const usage = (input: number, output: number, cache: number) => payload("token_count",{info:{total_token_usage:{input_tokens:input,output_tokens:output,cached_input_tokens:cache,cache_write_input_tokens:0}}});
    const file = path.join(session,"rollout-date-01a122c2-44a9-71a1-b650-14ae87424025.jsonl");
    writeFileSync(file,[JSON.stringify({type:"session_meta"}),usage(1000,100,800),payload("task_started"),usage(1250,120,1000),payload("task_complete")].join("\n"));
    const insert = db.prepare("INSERT INTO account_usage VALUES (?,?,?,?,?,?,?,?,?)");
    insert.run(ownerId,"fixture-message","codex","2026-10-11T10:00:02Z",1250,120,1370,1000,0);
    insert.run("other-owner","fixture-message","codex","2026-10-11T10:00:02Z",1250,120,1370,1000,0);
    insert.run(ownerId,"already-turn","codex","2026-10-11T10:00:02Z",250,20,270,200,0);
    const meta = {providerId:"codex",inputTokens:1250,outputTokens:120,totalTokens:1370,cachedInputTokens:1000,cacheWriteInputTokens:0,contextUsedTokens:40000,completedAt:"2026-10-11T10:00:02Z"};
    const chat = {id:"fixture-chat",updatedAt:"original",messages:[{id:"fixture-message",role:"assistant",content:"unchanged",parts:[{type:"text",content:"unchanged"}],runMetadata:meta},{id:"currently-running",role:"assistant",content:"streaming"}],sessionState:{input:"draft",queuedMessages:[{id:"pending",text:"keep queue"}]},activeRunId:"running"};
    db.prepare("INSERT INTO chats VALUES (?,?,?,?)").run(chat.id,ownerId,JSON.stringify(chat),"original");
    const beforeChat = db.prepare("SELECT data FROM chats").get()!.data;
    const dry = await repairCodexUsage({db,ownerId,dataDir});
    assert.equal(dry.corrected,1); assert.equal(dry.applied,false);
    assert.equal(db.prepare("SELECT data FROM chats").get()!.data,beforeChat);
    assert.equal(db.prepare("SELECT total_tokens FROM account_usage WHERE owner_id=? AND message_id=?").get(ownerId,"fixture-message")!.total_tokens,1370);
    await assert.rejects(repairCodexUsage({db,ownerId,dataDir,apply:true}),/backup/);
    const backupPath = path.join(dataDir,"backup.json");
    const applied = await repairCodexUsage({db,ownerId,dataDir,apply:true,backupPath});
    assert.equal(applied.corrected,1); assert.equal(applied.updatedChats,1);
    assert.equal(db.prepare("SELECT total_tokens FROM account_usage WHERE owner_id=? AND message_id=?").get(ownerId,"fixture-message")!.total_tokens,270);
    assert.equal(db.prepare("SELECT total_tokens FROM account_usage WHERE owner_id=? AND message_id=?").get("other-owner","fixture-message")!.total_tokens,1370);
    const updated = JSON.parse(db.prepare("SELECT data FROM chats").get()!.data as string);
    assert.deepEqual(updated.sessionState,chat.sessionState);
    assert.equal(updated.activeRunId,chat.activeRunId);
    assert.deepEqual(updated.messages[1],chat.messages[1]);
    assert.equal(updated.messages[0].content,"unchanged");
    assert.equal(updated.messages[0].runMetadata.inputTokens,250);
    assert.equal(updated.messages[0].runMetadata.cachedInputTokens,200);
    assert.equal(updated.messages[0].runMetadata.contextUsedTokens,40000);
    assert.equal(updated.messages[0].runMetadata.tokenUsageScope,"turn");
    assert.equal(JSON.parse(readFileSync(backupPath,"utf8")).repairs[0].before.total_tokens,1370);
    assert.equal((await repairCodexUsage({db,ownerId,dataDir})).corrected,0);
  } finally { db.close();rmSync(dataDir,{recursive:true,force:true}); }
});

test("ambiguous or old native completions cannot change reported usage", async () => {
  const dataDir=mkdtempSync(path.join(os.tmpdir(),"metis-usage-unproven-"));
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE account_usage(owner_id TEXT,message_id TEXT,provider_id TEXT,completed_at TEXT,input_tokens INTEGER,output_tokens INTEGER,total_tokens INTEGER,cached_input_tokens INTEGER,cache_write_input_tokens INTEGER);");
    const session=path.join(dataDir,"provider-sessions","codex","fixture","conn","sessions");
    mkdirSync(session,{recursive:true});
    const events=[{type:"session_meta"},{type:"event_msg",payload:{type:"task_started"}},{type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:100,output_tokens:10}}}},{timestamp:"2026-10-11T10:00:00Z",type:"event_msg",payload:{type:"task_complete"}}].map(JSON.stringify).join("\n");
    writeFileSync(path.join(session,"rollout-date-01a122c2-44a9-71a1-b650-14ae87424025.jsonl"),events);
    db.prepare("INSERT INTO account_usage VALUES (?,?,?,?,?,?,?,?,?)").run("fixture","old","codex","2026-10-11T11:00:00Z",100,10,110,null,null);
    assert.equal((await repairCodexUsage({db,ownerId:"fixture",dataDir})).proven,0);
    writeFileSync(path.join(session,"rollout-copy-01a122c2-44a9-71a1-b650-14ae87424026.jsonl"),events);
    db.prepare("INSERT INTO account_usage VALUES (?,?,?,?,?,?,?,?,?)").run("fixture","ambiguous","codex","2026-10-11T10:00:02Z",100,10,110,null,null);
    const result=await repairCodexUsage({db,ownerId:"fixture",dataDir});
    assert.equal(result.proven,0);assert.equal(result.corrected,0);assert.equal(result.unmatched,2);
  } finally {db.close();rmSync(dataDir,{recursive:true,force:true});}
});
