import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync,rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const data=mkdtempSync(path.join(os.tmpdir(),"metis-usage-binding-"));
process.env.CHAT_DATA_DIR=data;
process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");
process.env.AI_CHAT_ROOT=data;
process.env.AGENT_CWD=data;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});

test("cumulative baselines survive same-cursor updates and reset when the native thread changes", async()=>{
  const {createUser}=await import("../lib/auth");
  const {createChat}=await import("../lib/db-store");
  const {updateProviderSessionBinding}=await import("../lib/providers/session-bindings");
  const owner=createUser("baseline-fixture","synthetic-password-123");
  const chat=createChat("baseline fixture",undefined,owner.id);
  const base={chatId:chat.id,ownerId:owner.id,execution:"codex-sdk" as const,connectionId:"conn-one",contextOwner:"native" as const,promoteCursor:true};
  const totals={inputTokens:1000,outputTokens:50,cachedInputTokens:900};
  assert.deepEqual(updateProviderSessionBinding({...base,candidateCursor:"thread-a",lastUsageTotals:totals})?.lastUsageTotals,totals);
  assert.deepEqual(updateProviderSessionBinding({...base,candidateCursor:"thread-a",lastContextTokens:300})?.lastUsageTotals,totals);
  assert.equal(updateProviderSessionBinding({...base,connectionId:"conn-two",candidateCursor:"thread-a"})?.lastUsageTotals,undefined);
  assert.equal(updateProviderSessionBinding({...base,candidateCursor:"thread-b"})?.lastUsageTotals,undefined);
  assert.deepEqual(updateProviderSessionBinding({...base,candidateCursor:"thread-b",lastUsageTotals:{inputTokens:10,outputTokens:2}})?.lastUsageTotals,{inputTokens:10,outputTokens:2});
});
