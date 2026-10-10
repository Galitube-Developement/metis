import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createNotificationReceiver } from "../remote-client/notification-client.mjs";
const require = createRequire(import.meta.url);
const { notificationChatUrl, showNativeNotification } = require("../remote-client/notification-native.cjs");

const notification = (id="n1") => ({id,title:"Isolated test",body:"Fake only",chatId:"chat/ ?&c=evil",createdAt:new Date().toISOString()});
class FakeNotification extends EventEmitter {
  static supported=true;
  static instances=[];
  static mode="show";
  static isSupported(){return this.supported;}
  constructor(options){super();this.options=options;FakeNotification.instances.push(this);}
  show(){queueMicrotask(()=>{if(FakeNotification.mode==="show")this.emit("show");if(FakeNotification.mode==="failed")this.emit("failed");});}
}
test("native bridge ACK waits for show, reports failure/timeout, and opens an encoded same-origin chat",async()=>{
  const opened=[];
  const n=notification();
  const promise=showNativeNotification({Notification:FakeNotification,openExternal:async url=>opened.push(url),server:"https://metis.invalid/base",notification:n});
  await promise;
  const native=FakeNotification.instances.at(-1);
  assert.deepEqual(native.options,{title:n.title,body:n.body});
  native.emit("click");
  assert.equal(new URL(opened[0]).origin,"https://metis.invalid");
  assert.equal(new URL(opened[0]).searchParams.get("c"),n.chatId);
  assert.equal(new URL(opened[0]).pathname,"/");
  assert.throws(()=>notificationChatUrl("javascript:alert(1)","x"));
  assert.throws(()=>notificationChatUrl("https://user:secret@metis.invalid","x"));
  FakeNotification.mode="failed";
  await assert.rejects(showNativeNotification({Notification:FakeNotification,openExternal:()=>{},server:"https://metis.invalid",notification:n}),/failed/);
  FakeNotification.mode="silent";
  await assert.rejects(showNativeNotification({Notification:FakeNotification,openExternal:()=>{},server:"https://metis.invalid",notification:n,timeoutMs:5}),/timed out/);
  FakeNotification.supported=false;
  await assert.rejects(showNativeNotification({Notification:FakeNotification,openExternal:()=>{},server:"https://metis.invalid",notification:n}),/unavailable/);
  FakeNotification.supported=true;FakeNotification.mode="show";
});
test("receiver validates fields, dedupes concurrent deliveries and reconnect/restart, and isolates credentials",async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-native-fake-"));
  try {
    const config={server:"https://metis.invalid",clientId:"fake-client",credential:"fake-credential"};
    let displays=0;
    const args={config,configPath:path.join(dir,"config.json"),available:()=>true,show:async n=>{displays++;assert.equal(n.url,undefined);await new Promise(r=>setTimeout(r,5));}};
    const receiver=createNotificationReceiver(args);
    const msg={type:"notification",requestId:"request1",notification:{...notification(),url:"https://evil.invalid",command:"never execute"}};
    const acks=await Promise.all([receiver(msg),receiver({...msg,requestId:"request2"})]);
    assert.equal(displays,1);assert.ok(acks.every(x=>x.ok===true));
    const restart=createNotificationReceiver(args);
    assert.equal((await restart(msg)).ok,true);assert.equal(displays,1);
    const other=createNotificationReceiver({...args,config:{...config,credential:"new-credential"}});
    assert.equal((await other(msg)).ok,true);assert.equal(displays,2);
    assert.equal(await receiver({...msg,notification:{...msg.notification,title:"x".repeat(161)}}),null);
    assert.equal(await receiver({...msg,notification:{...msg.notification,createdAt:"invalid"}}),null);
    assert.equal(await receiver({...msg,notification:{...msg.notification,createdAt:new Date(Date.now()-86401000).toISOString()}}),null);
    const headless=createNotificationReceiver({...args,available:()=>false});
    assert.equal((await headless({...msg,notification:notification("headless")})).ok,false);
    const failed=createNotificationReceiver({...args,show:async()=>{throw new Error("fake failure");}});
    assert.equal((await failed({...msg,notification:notification("failed")})).ok,false);
    assert.equal((await receiver({...msg,notification:notification("failed")})).ok,true);
    assert.equal(displays,3);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
