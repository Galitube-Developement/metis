import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostSource = readFileSync(path.join(repo, "install/windows-script-host.mjs"), "utf8");
const launcherSource = readFileSync(path.join(repo, "install/windows-launcher.vbs"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check) {
  for (let i=0;i<80;i++) { if (check()) return; await sleep(250); }
  throw new Error("Fixture did not reach expected state");
}
test("script host preserves production, hidden launch, and scoped child contract", () => {
  assert.match(hostSource, /realpathSync\.native/);
  assert.match(hostSource, /NODE_ENV = "production"/);
  assert.match(hostSource, /windowsHide: true/);
  assert.match(launcherSource, /shell\.Run command, 0, False/);
  assert.match(launcherSource, /Charset = "utf-8"/);
});
test("Windows supervisor respawns a failed child, preserves an unrelated process, and stops its tree", {skip:process.platform!=="win32",timeout:40000}, async () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(),"metis-ai-e2e-script-host-"));
  const caller = mkdtempSync(path.join(os.tmpdir(),"metis-e2e-caller-"));
  let host, sentinel;
  try {
    mkdirSync(path.join(fixture,"node_modules/tsx"),{recursive:true});
    writeFileSync(path.join(fixture,"node_modules/tsx/package.json"),'{"type":"module","exports":"./index.mjs"}');
    writeFileSync(path.join(fixture,"node_modules/tsx/index.mjs"),"");
    writeFileSync(path.join(fixture,".env"),"PORT=44100\nMCP_PORT=44101\nCHAT_DATA_DIR="+fixture+"\nMETIS_NODE_BIN="+process.execPath+"\nNODE_ENV=development\n");
    const source = 'import {writeFileSync} from "node:fs";writeFileSync(new URL("./state-NAME.json",import.meta.url),JSON.stringify({pid:process.pid,env:process.env.NODE_ENV}));console.log("NAME started");setInterval(()=>{},1000);';
    for(const [name,rel] of [["app","server.mjs"],["worker","worker.ts"],["mcp","lib/mcp-core/gateway-core.mjs"]]){
      mkdirSync(path.dirname(path.join(fixture,rel)),{recursive:true});
      writeFileSync(path.join(fixture,rel),source.replaceAll("NAME",name));
    }
    const hostPath=path.join(fixture,"windows-script-host.mjs");
    writeFileSync(hostPath,hostSource);
    const sentinelFile=path.join(caller,"sentinel.mjs");writeFileSync(sentinelFile,"setInterval(()=>{},1000)");
    sentinel=spawn(process.execPath,[sentinelFile],{windowsHide:true,stdio:"ignore"});
    host=spawn(process.execPath,[hostPath],{cwd:caller,windowsHide:true,stdio:"ignore"});
    const stateFile=path.join(fixture,"state-app.json");
    await until(()=>existsSync(stateFile));
    const first=JSON.parse(readFileSync(stateFile,"utf8"));
    assert.equal(first.env,"production");
    const lock=JSON.parse(readFileSync(path.join(fixture,".windows-script-host.lock"),"utf8"));
    assert.ok(lock.root.endsWith(path.basename(fixture)));
    spawnSync("taskkill.exe",["/PID",String(first.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    await until(()=>{try{return JSON.parse(readFileSync(stateFile,"utf8")).pid!==first.pid}catch{return false}});
    const stopped=spawnSync(process.execPath,[hostPath,"--stop"],{cwd:caller,windowsHide:true,encoding:"utf8",timeout:20000});
    assert.equal(stopped.status,0,stopped.stderr);
    await until(()=>host.exitCode!==null);
    assert.equal(host.exitCode,0);
    assert.equal(existsSync(path.join(fixture,".windows-script-host.lock")),false);
    assert.equal(sentinel.exitCode,null);
    assert.doesNotThrow(()=>process.kill(sentinel.pid,0));
  } finally {
    if(host?.exitCode===null) spawnSync("taskkill.exe",["/PID",String(host.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    if(sentinel?.exitCode===null) spawnSync("taskkill.exe",["/PID",String(sentinel.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    await sleep(300);
    rmSync(fixture,{recursive:true,force:true});rmSync(caller,{recursive:true,force:true});
  }
});
