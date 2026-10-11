import assert from "node:assert/strict";
import {test} from "node:test";
import {searchDirectory,knownDirectorySkill} from "../lib/skills-directory";
test("public search validates results, separates equal slugs and caches requests",async()=>{
  const original=globalThis.fetch;let calls=0;
  delete process.env.VERCEL_OIDC_TOKEN;
  globalThis.fetch=async input=>{
    calls++;assert.match(String(input),/^https:\/\/skills.sh\/api\/search\?/);
    return Response.json({skills:[
      {id:"first/repo/checklist",name:"Checklist",source:"first/repo",installs:10},
      {id:"other/repo/checklist",name:"Checklist",source:"other/repo",installs:5},
      {id:"bad",name:"Bad",source:"--malicious",skillId:"--exec"},
    ]});
  };
  try {
    const first=await searchDirectory("checklist");
    assert.equal(first.origin,"skills.sh");assert.equal(first.skills.length,2);
    assert.notEqual(first.skills[0].catalogId,first.skills[1].catalogId);
    assert.equal(knownDirectorySkill("--malicious/bad"),undefined);
    await searchDirectory("checklist");assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
test("directory failures degrade to the built-in catalog without claiming no matches",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response("",{status:429});
  try {const result=await searchDirectory("PDF");assert.equal(result.origin,"built-in");assert.ok(result.notice);assert.ok(result.skills.some(s=>s.id==="pdf"));}finally{globalThis.fetch=original;}
});
test("documented v1 API uses a fresh server-side OIDC token",async()=>{
  const original=globalThis.fetch;process.env.VERCEL_OIDC_TOKEN="test-only-oidc";
  globalThis.fetch=async(input,init)=>{
    assert.match(String(input),/api\/v1\/skills\/search/);
    assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer test-only-oidc");
    return Response.json({data:[{id:"official/repo/react",slug:"react",name:"React",source:"official/repo",installs:100}]});
  };
  try {assert.equal((await searchDirectory("react-unique-query")).skills[0].catalogId,"official/repo/react");}
  finally{globalThis.fetch=original;delete process.env.VERCEL_OIDC_TOKEN;}
});
