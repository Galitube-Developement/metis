import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { startRemoteClient } from "../remote-client/client.mjs";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn){for(let i=0;i<200;i++){if(fn())return;await pause(5);}throw new Error("Fake protocol timed out");}
test("real client notification wire protocol ignores pre-auth, advertises native capability, ACKs display and dedupes reconnect",async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-notification-wire-"));
  const server=new WebSocketServer({host:"127.0.0.1",port:0});
  await new Promise(resolve=>server.once("listening",resolve));
  const sockets=[],messages=[];
  server.on("connection",socket=>{
    sockets.push(socket);
    socket.on("message",raw=>{const msg=JSON.parse(String(raw));messages.push(msg);if(msg.type==="heartbeat")socket.send(JSON.stringify({type:"heartbeat_ack"}));});
  });
  let displays=0;
  let runtime;
  const n={id:"fake-wire-id",title:"Fake only",body:"No OS notification",chatId:"fake-chat",createdAt:new Date().toISOString()};
  const wire=requestId=>JSON.stringify({type:"notification",requestId,notification:n});
  try{
    runtime=startRemoteClient({configPath:path.join(dir,"config.json"),config:{server:"http://127.0.0.1:"+server.address().port,clientId:"fake-client",credential:"fake-credential"},
      nativeNotificationsAvailable:()=>true,showNotification:async()=>{displays++;}});
    await waitFor(()=>messages.some(m=>m.type==="auth"));
    sockets[0].send(wire("before-auth"));
    await pause(30);assert.equal(displays,0);assert.equal(messages.filter(m=>m.type==="notification_ack").length,0);
    sockets[0].send(JSON.stringify({type:"authenticated",clientId:"fake-client"}));
    await waitFor(()=>messages.some(m=>m.type==="heartbeat"));
    assert.equal(messages.find(m=>m.type==="heartbeat").nativeNotifications,true);
    sockets[0].send(wire("first"));
    await waitFor(()=>messages.some(m=>m.type==="notification_ack"));
    assert.equal(messages.find(m=>m.requestId==="first").ok,true);assert.equal(displays,1);
    sockets[0].terminate();
    await waitFor(()=>sockets.length===2);
    sockets[1].send(JSON.stringify({type:"authenticated",clientId:"fake-client"}));
    sockets[1].send(wire("reconnect"));
    await waitFor(()=>messages.some(m=>m.requestId==="reconnect"));
    assert.equal(messages.find(m=>m.requestId==="reconnect").notificationId,n.id);
    assert.equal(displays,1);
  }finally{
    runtime?.stop();for(const socket of server.clients)socket.terminate();
    await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});
  }
});
