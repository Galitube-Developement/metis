import type { VoiceSnapshot } from "@/lib/voice-conversation";
import { applyVoiceTurnEvent, parseVoiceChannelEvent, type VoiceTurnEvent, type VoiceTurnTranscript } from "@/lib/voice-protocol";

export type VoiceClientState = {
  state: "idle" | "connecting" | "connected" | "error";
  phase: "permission" | "connecting" | "listening" | "speaking";
  muted: boolean; playbackBlocked: boolean; error?: string;
  inputLevel: number; outputLevel: number; snapshot?: VoiceSnapshot;
};

const initial = (): VoiceClientState => ({
  state: "idle", phase: "connecting", muted: false, playbackBlocked: false, inputLevel: 0, outputLevel: 0,
});

/** Owns all microphone, playback, peer and HTTP resources for exactly one call. */
export class VoiceConversationClient {
  private generation = 0;
  private stream?: MediaStream;
  private peer?: RTCPeerConnection;
  private audio?: HTMLAudioElement;
  private context?: AudioContext;
  private request?: AbortController;
  private sessionId?: string;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private frame?: number;
  private completed = new Set<string>();
  private turns = new Map<string, VoiceTurnTranscript>();
  private eventQueue: VoiceTurnEvent[] = [];
  private eventTimer?: ReturnType<typeof setTimeout>;
  private eventTail: Promise<void> = Promise.resolve();
  readonly chatId: string;
  readonly modelId: string;
  current = initial();

  constructor(
    input: { chatId: string; modelId: string },
    private changed: (state: VoiceClientState) => void,
    private transcriptChanged: () => void,
  ) { this.chatId = input.chatId; this.modelId = input.modelId; }

  private update(patch: Partial<VoiceClientState>) {
    this.current = { ...this.current, ...patch };
    this.changed(this.current);
  }

  async connect() {
    const generation = ++this.generation;
    this.update({ ...initial(), state: "connecting", phase: "permission" });
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        throw new Error("Voice needs microphone access in a supported browser over HTTPS.");
      }
      this.audio = new Audio();
      this.audio.autoplay = true;
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Permission can complete after Hang up / navigation. Release the late stream.
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      this.update({ phase: "connecting" });
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const inputMeter = context.createAnalyser();
      inputMeter.fftSize = 256;
      context.createMediaStreamSource(stream).connect(inputMeter);
      const outputMeter = context.createAnalyser();
      outputMeter.fftSize = 256;
      this.meter(inputMeter, outputMeter, generation);
      for (const track of stream.getTracks()) {
        track.onended = () => { if (generation === this.generation) this.fail(new Error("Microphone access ended. Start a new conversation.")); };
        peer.addTrack(track, stream);
      }
      // Audio flows over WebRTC; this channel supports the provider's native call.
      const channel = peer.createDataChannel("oai-events");
      channel.onmessage = (message) => {
        if (generation !== this.generation) return;
        try {
          const event = parseVoiceChannelEvent(JSON.parse(message.data));
          if (!event) return;
          const next = applyVoiceTurnEvent(this.turns.get(event.id), event);
          if (next) this.turns.set(event.id, next);
          while (this.turns.size > 150) this.turns.delete(this.turns.keys().next().value!);
          this.update({ snapshot: { sessionId: this.sessionId || "", state: "connected", transcripts: [...this.turns.values()].slice(-100) } });
          this.eventQueue.push(event);
          if (event.type === "done") this.flushEvents(generation);
          else if (!this.eventTimer) this.eventTimer = setTimeout(() => this.flushEvents(generation), 200);
        } catch { this.fail(new Error("Could not read the voice transcript. Try again.")); }
      };
      peer.ontrack = (event) => {
        if (generation !== this.generation) return;
        const remote = event.streams[0] || new MediaStream([event.track]);
        this.audio!.srcObject = remote;
        context.createMediaStreamSource(remote).connect(outputMeter);
        void this.audio!.play().catch(() => { if (generation === this.generation) this.update({ playbackBlocked: true }); });
      };
      peer.onconnectionstatechange = () => {
        if (generation !== this.generation) return;
        if (peer.connectionState === "connected") {
          clearTimeout(this.connectTimer);
          clearTimeout(this.disconnectTimer);
          this.update({ state: "connected", phase: "listening" });
        } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          this.fail(new Error("The voice connection ended. Try again."));
        } else if (peer.connectionState === "disconnected") {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => this.fail(new Error("The voice connection was interrupted. Try again.")), 8_000);
        }
      };
      this.connectTimer = setTimeout(() => this.fail(new Error("The voice connection timed out. Try again.")), 45_000);
      await peer.setLocalDescription(await peer.createOffer());
      this.request = new AbortController();
      const response = await fetch("/api/voice/conversation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: this.chatId, modelId: this.modelId, sdp: peer.localDescription?.sdp }),
        signal: this.request.signal,
      });
      const body = await response.json();
      // If the request finished after cancellation, still retire its server session.
      if (generation !== this.generation) {
        if (typeof body.sessionId === "string") void this.stopServer(body.sessionId);
        return;
      }
      if (!response.ok) throw new Error(body.error || "Could not connect voice.");
      if (typeof body.sessionId !== "string" || typeof body.sdp !== "string") throw new Error("The voice connection returned an invalid response.");
      this.sessionId = body.sessionId;
      await peer.setRemoteDescription({ type: "answer", sdp: body.sdp });
      if (generation !== this.generation) return;
      void this.poll(generation);
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error : new Error("Could not connect voice."));
    }
  }

  private meter(input: AnalyserNode, output: AnalyserNode, generation: number) {
    const inputData = new Uint8Array(input.fftSize);
    const outputData = new Uint8Array(output.fftSize);
    let last = 0;
    const rms = (analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>) => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += ((sample - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / data.length) * 5);
    };
    const tick = (now: number) => {
      if (generation !== this.generation) return;
      if (now - last >= 90) {
        last = now;
        const outputLevel = rms(output, outputData);
        this.update({
          inputLevel: this.current.muted ? 0 : rms(input, inputData),
          outputLevel,
          ...(this.current.state === "connected" ? { phase: outputLevel > 0.04 ? "speaking" : "listening" } : {}),
        });
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private async poll(generation: number, failures = 0) {
    if (generation !== this.generation || !this.sessionId) return;
    try {
      const response = await fetch("/api/voice/conversation?sessionId=" + encodeURIComponent(this.sessionId), { cache: "no-store", signal: this.request?.signal });
      const body = await response.json() as VoiceSnapshot & { error?: string };
      if (generation !== this.generation) return;
      if (!response.ok || body.state === "error") throw new Error(body.error || "The voice conversation has ended.");
      // WebRTC V3 turns are authoritative; older poll responses must not roll
      // a live transcript back while its relay request is in flight.
      this.update({ snapshot: { ...body, transcripts: this.turns.size ? [...this.turns.values()].slice(-100) : body.transcripts } });
      let changed = false;
      for (const transcript of body.transcripts || []) {
        if (transcript.complete && !this.completed.has(transcript.id)) { this.completed.add(transcript.id); changed = true; }
      }
      if (changed) this.transcriptChanged();
      if (body.state === "closed") { this.disconnect(); return; }
      this.pollTimer = setTimeout(() => { void this.poll(generation); }, 1_500);
    } catch (error) {
      if (generation !== this.generation) return;
      if (failures < 2) {
        this.pollTimer = setTimeout(() => { void this.poll(generation, failures + 1); }, 1_500);
      } else this.fail(error instanceof Error ? error : new Error("The voice conversation was interrupted."));
    }
  }

  private flushEvents(generation: number) {
    clearTimeout(this.eventTimer);
    this.eventTimer = undefined;
    const sessionId = this.sessionId;
    if (!sessionId || !this.eventQueue.length) return;
    const events = this.eventQueue.splice(0, 64);
    this.eventTail = this.eventTail.then(async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 10_000);
      try {
        const body = JSON.stringify({ sessionId, events });
        const response = await fetch("/api/voice/conversation", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body, signal: abort.signal, keepalive: new Blob([body]).size < 60 * 1024,
        });
        if (!response.ok) throw new Error("The conversation could not be saved. Please reconnect.");
        if (events.some((event) => event.type === "done")) this.transcriptChanged();
      } catch (error) {
        if (generation === this.generation) this.fail(error instanceof Error ? error : new Error("The conversation could not be saved."));
      } finally { clearTimeout(timeout); }
    });
    if (this.eventQueue.length) this.flushEvents(generation);
  }

  setMuted(muted: boolean) {
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    this.update({ muted });
  }

  async enablePlayback() {
    try { await this.audio?.play(); this.update({ playbackBlocked: false }); }
    catch { this.update({ playbackBlocked: true }); }
  }

  private fail(error: Error) {
    this.disconnect(false);
    this.update({ state: "error", error: error.message, inputLevel: 0, outputLevel: 0 });
  }

  private async stopServer(sessionId: string) {
    try {
      await fetch("/api/voice/conversation?sessionId=" + encodeURIComponent(sessionId), { method: "DELETE", keepalive: true });
      this.transcriptChanged();
    } catch { /* Server heartbeat expiry retires calls after abrupt disconnects. */ }
  }

  disconnect(notify = true) {
    this.flushEvents(this.generation);
    ++this.generation;
    clearTimeout(this.pollTimer);
    clearTimeout(this.connectTimer);
    clearTimeout(this.disconnectTimer);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.request?.abort();
    this.request = undefined;
    this.peer?.close();
    this.peer = undefined;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = undefined;
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
    this.audio = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    if (sessionId) void this.eventTail.then(() => this.stopServer(sessionId));
    if (notify) this.update({ state: "idle", inputLevel: 0, outputLevel: 0, muted: false, playbackBlocked: false });
  }
}
