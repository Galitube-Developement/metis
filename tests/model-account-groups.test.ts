import assert from "node:assert/strict";
import test from "node:test";
import { modelAccountGroups, modelAccountKey, modelMatchesAccount } from "../lib/model-account-groups";

const models = [
 { id:"codex:personal:shared-model", providerId:"codex", providerName:"Codex", connectionId:"personal", connectionLabel:"Personal" },
 { id:"codex:work:shared-model", providerId:"codex", providerName:"Codex", connectionId:"work", connectionLabel:"Work" },
 { id:"openai:other:shared-model", providerId:"openai", providerName:"OpenAI", connectionId:"other", connectionLabel:"API account" },
];

test("same provider and model produce distinct account tabs and scoped filtering", () => {
 const groups=modelAccountGroups(models);
 assert.deepEqual(groups.map(g=>g.value),["codex:personal","codex:work","openai:other"]);
 assert.deepEqual(groups.map(g=>g.label),["Personal","Work","API account"]);
 assert.deepEqual(models.filter(m=>modelMatchesAccount(m,groups[1].value)).map(m=>m.id),["codex:work:shared-model"]);
 assert.equal(models.filter(m=>modelMatchesAccount(m,"codex")).length,2,"provider:model search spans accounts");
 assert.equal(models.filter(m=>modelMatchesAccount(m,"all")).length,3);
});
test("renaming accounts changes labels without changing keys, favorites or selected models", () => {
 const before=modelAccountGroups(models);
 const after=modelAccountGroups(models.map(m=>({...m,connectionLabel:m.connectionId==="work"?"Renamed":m.connectionLabel})));
 assert.deepEqual(before.map(g=>g.value),after.map(g=>g.value));
 assert.equal(after[1].label,"Renamed");
 assert.equal(modelAccountKey({...models[1],connectionLabel:"Renamed"}),"codex:work");
});
test("configured accounts without discovered models remain separate and duplicates get readable labels", () => {
 const groups=modelAccountGroups([],[
  {id:"a",providerKey:"codex",label:"Codex"},
  {id:"b",providerKey:"codex",label:"Codex"},
  {id:"c",providerKey:"openai",label:"Disabled",enabled:false},
 ]);
 assert.deepEqual(groups.map(g=>g.value),["codex:a","codex:b"]);
 assert.deepEqual(groups.map(g=>g.label),["Codex (1)","Codex (2)"]);
});
test("connection identity is read from scoped model IDs and legacy models remain usable", () => {
 assert.equal(modelAccountKey({id:"codex:work:shared-model"}),"codex:work");
 assert.equal(modelAccountKey({id:"legacy-model"}),"cursor");
 assert.ok(modelMatchesAccount({id:"legacy-model"},"cursor"));
 assert.ok(!modelMatchesAccount({id:"codex:personal:shared-model"},"codex:work"));
});
