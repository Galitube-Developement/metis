import assert from "node:assert/strict";
import test from "node:test";
import { VoiceConversationClient } from "../lib/voice-conversation-client";

function fixture(t: import("node:test").TestContext) {
  let stopped = 0, peersClosed = 0, contextsClosed = 0, paused = 0;
  let allow!: (value: unknown) => void;
  const track = { enabled: true, onended: null as null | (() => void), stop: () => { stopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const permission = new Promise((resolve) => { allow = resolve; });
  const requests: Array<{ url: string; method: string }> = [];
  const analyser = { fftSize: 256, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) };
  let peer!: FakePeer;
  const channel = { onmessage: undefined as undefined | ((message: { data: string }) => void) };
  class FakePeer {
    connectionState = "connecting";
    localDescription = { sdp: "v=0\r\nm=audio 9\r\n" };
    onconnectionstatechange?: () => void;
    ontrack?: (event: unknown) => void;
    constructor() { peer = this; }
    addTrack() {}
    createDataChannel() { return channel; }
    async createOffer() { return this.localDescription; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.connectionState = "connected"; this.onconnectionstatechange?.(); }
    close() { peersClosed++; this.connectionState = "closed"; this.onconnectionstatechange?.(); }
  }
  class FakeContext {
    async resume() {}
    async close() { contextsClosed++; }
    createAnalyser() { return { ...analyser }; }
    createMediaStreamSource() { return { connect() {} }; }
  }
  class FakeAudio {
    autoplay = false;
    srcObject: unknown;
    async play() {}
    pause() { paused++; }
  }
  const globals: Record<string, unknown> = {
    navigator: { mediaDevices: { getUserMedia: () => permission } },
    Audio: FakeAudio, AudioContext: FakeContext, RTCPeerConnection: FakePeer,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  let post: (() => Promise<Response>) | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    requests.push({ url, method });
    if (method === "POST") return post ? post() : Response.json({ sessionId: "session", sdp: "answer" }, { status: 201 });
    if (method === "DELETE") return Response.json({ state: "closed", transcripts: [] });
    return Response.json({ sessionId: "session", state: "connected", transcripts: [] });
  });
  const states: import("../lib/voice-conversation-client").VoiceClientState[] = [];
  const client = new VoiceConversationClient({ chatId: "chat", modelId: "selected-model" }, (state) => states.push(state), () => {});
  t.after(() => client.disconnect(false));
  return {
    client, track, requests, states, allow: () => allow(stream), peer: () => peer,
    setPost: (handler: () => Promise<Response>) => { post = handler; },
    message: (event: unknown) => channel.onmessage?.({ data: JSON.stringify(event) }),
    counts: () => ({ stopped, peersClosed, contextsClosed, paused }),
  };
}

test("hanging up while microphone permission is pending releases a late stream", async (t) => {
  const f = fixture(t);
  const connecting = f.client.connect();
  await Promise.resolve();
  f.client.disconnect();
  f.allow();
  await connecting;
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.counts().contextsClosed, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.client.current.state, "idle");
});

test("a connected full duplex call can mute its outgoing track and retires all resources", async (t) => {
  const f = fixture(t);
  const connecting = f.client.connect();
  f.allow();
  await connecting;
  assert.equal(f.client.current.state, "connected");
  f.client.setMuted(true);
  assert.equal(f.track.enabled, false);
  f.client.setMuted(false);
  assert.equal(f.track.enabled, true);
  f.client.disconnect();
  await Promise.resolve();
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.counts().peersClosed, 1);
  assert.equal(f.counts().contextsClosed, 1);
  assert.equal(f.requests.filter((request) => request.method === "DELETE").length, 1);
});

test("a server session created after cancellation is still explicitly ended", async (t) => {
  const f = fixture(t);
  let finish!: (response: Response) => void;
  f.setPost(() => new Promise((resolve) => { finish = resolve; }));
  const connecting = f.client.connect();
  f.allow();
  for (let index = 0; index < 10 && !finish; index++) await Promise.resolve();
  assert.ok(finish, "signaling reached the server");
  f.client.disconnect();
  finish(Response.json({ sessionId: "late-session", sdp: "answer" }, { status: 201 }));
  await connecting;
  assert.ok(f.requests.some((request) => request.method === "DELETE" && request.url.includes("late-session")));
  assert.equal(f.client.current.state, "idle");
});

test("signaling rejection shows an error and shuts down the microphone", async (t) => {
  const f = fixture(t);
  f.setPost(async () => Response.json({ error: "Voice unavailable for your account" }, { status: 502 }));
  const connecting = f.client.connect();
  f.allow();
  await connecting;
  assert.equal(f.client.current.state, "error");
  assert.match(f.client.current.error || "", /unavailable/);
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.counts().peersClosed, 1);
});

test("WebRTC turn relay preserves final transcript before hanging up", async(t)=>{
 const f=fixture(t);const connecting=f.client.connect();f.allow();await connecting;
 f.message({type:"turn.created",turn:{id:"turn_one",role:"user",transcript:"Hello"}});
 f.message({type:"turn.delta",turn_id:"turn_one",delta:" Metis"});
 f.message({type:"turn.done",turn:{id:"turn_one",role:"user",transcript:"Hello Metis."}});
 assert.equal(f.client.current.snapshot?.transcripts[0].text,"Hello Metis.");
 assert.equal(f.client.current.snapshot?.transcripts[0].complete,true);
 f.client.disconnect();
 for(let i=0;i<12;i++)await Promise.resolve();
 const methods=f.requests.map(request=>request.method);
 assert.ok(methods.includes("PATCH"));
 assert.ok(methods.includes("DELETE"));
 assert.ok(methods.indexOf("PATCH")<methods.indexOf("DELETE"));
});
