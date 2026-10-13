import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PROJECT_ICON_NAMES } from "../lib/project-icon-names";
import { isProjectIcon, projectIconName, projectIconLabel, normalizeProjectColor, projectIconForeground, searchProjectIcons } from "../lib/project-appearance";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-project-appearance-"));
process.env.CHAT_DATA_DIR = root;
process.env.CHAT_DB_PATH = path.join(root, "chat.sqlite");
process.env.AI_CHAT_ROOT = root;
process.env.AGENT_CWD = root;
test.after(() => rmSync(root, {recursive:true,force:true}));

test("catalog covers the installed icon library and preserves legacy meanings", () => {
  const check = spawnSync(process.execPath, ["scripts/generate-project-icons.mjs", "--check"], {encoding:"utf8"});
  assert.equal(check.status, 0, check.stderr);
  assert.equal(new Set(PROJECT_ICON_NAMES).size, PROJECT_ICON_NAMES.length);
  for (const name of PROJECT_ICON_NAMES) assert.equal(projectIconName("lucide:" + name), name);
  assert.equal(projectIconName("folder"), "folder-kanban");
  assert.equal(projectIconName("lucide:folder"), "folder");
  assert.equal(projectIconName("code"), "code-xml");
  assert.equal(projectIconName("flask"), "flask-conical");
  assert.equal(projectIconLabel("lucide:circle-check"), "Circle Check");
  for (const bad of ["lucide:made-up-icon","<svg>","__proto__","constructor",null,{}]) assert.equal(isProjectIcon(bad), false);
});

test("icon search supports case, spaces and hyphens across the whole catalog", () => {
  assert.equal(searchProjectIcons("").length, PROJECT_ICON_NAMES.length);
  assert.ok(searchProjectIcons("  CIRCLE CHECK  ").includes("circle-check"));
  assert.ok(searchProjectIcons("CircleCheck").includes("circle-check"));
  assert.ok(searchProjectIcons("circle-check").includes("circle-check"));
  assert.ok(searchProjectIcons("zodiac").includes("zodiac-virgo"));
  assert.deepEqual(searchProjectIcons("this-icon-does-not-exist"),[]);
});

test("custom colors normalize HEX input and keep bright icons readable", () => {
  assert.equal(normalizeProjectColor("#ABC"), "#aabbcc");
  assert.equal(normalizeProjectColor("  d13690 "), "#d13690");
  assert.equal(normalizeProjectColor("#FFFFFF"), "#ffffff");
  for (const value of ["red","var(--color)","#12345","#gggggg","url(x)",""]) assert.equal(normalizeProjectColor(value),null);
  assert.equal(projectIconForeground("#ffffff"),"#000000");
  assert.equal(projectIconForeground("#fff"),"#000000");
  assert.equal(projectIconForeground("#000000"),"#ffffff");
  assert.equal(projectIconForeground("#6366f1"),"#ffffff");
});

test("project API saves library icons and custom colors with account isolation", async () => {
  const [{getDatabase}, projects, {POST}, {GET,PATCH}] = await Promise.all([
    import("../lib/sqlite"), import("../lib/projects"), import("../app/api/projects/route"), import("../app/api/projects/[id]/route"),
  ]);
  const db=getDatabase(),now=new Date().toISOString(),owner=randomUUID(),foreign=randomUUID();
  const token=randomUUID(),foreignToken=randomUUID();
  for(const [id,value] of [[owner,token],[foreign,foreignToken]]) {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id,id,"unused",now);
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(createHash("sha256").update(value).digest("hex"),id,"2099-01-01T00:00:00Z");
  }
  const request=(method:string,body?:unknown,auth=token)=>new Request("http://test/api/projects",{
    method,headers:{cookie:"ai_chat_auth="+auth,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const createdResponse=await POST(request("POST",{name:"Custom appearance",icon:"lucide:zodiac-virgo",color:"#d13690"}));
  assert.equal(createdResponse.status,201);
  const {project}=await createdResponse.json();
  assert.equal(project.icon,"lucide:zodiac-virgo");assert.equal(project.color,"#d13690");
  const params={params:Promise.resolve({id:project.id})};
  const patchedResponse=await PATCH(request("PATCH",{icon:"lucide:folder",color:"#ffffff"}),params);
  assert.equal(patchedResponse.status,200);
  assert.equal(projects.getProject(project.id,owner)?.icon,"lucide:folder");
  assert.equal(projects.getProject(project.id,owner)?.color,"#ffffff");
  assert.equal((await GET(request("GET"),params)).status,200);
  assert.equal((await PATCH(request("PATCH",{icon:"lucide:cat",color:"#000000"},foreignToken),params)).status,404);
  assert.equal(projects.getProject(project.id,owner)?.icon,"lucide:folder");
  const retained=projects.updateProject(project.id,{icon:"lucide:not-real",color:"var(--evil)"},owner)!;
  assert.equal(retained.icon,"lucide:folder");assert.equal(retained.color,"#ffffff");
  const legacy=projects.createProject({ownerId:owner,icon:"folder",color:"#FFFFFF"});
  assert.equal(projects.getProject(legacy.id,owner)?.icon,"folder");
  assert.equal(projects.getProject(legacy.id,owner)?.color,"#FFFFFF");
  for(const name of ["cat","gamepad-2","zoom-out","a-arrow-down"]) {
    assert.ok(isProjectIcon("lucide:"+name));
    const value=projects.updateProject(project.id,{icon:"lucide:"+name},owner)!;
    assert.equal(value.icon,"lucide:"+name);
  }
});
