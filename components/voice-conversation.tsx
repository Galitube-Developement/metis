"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, ChevronDown, Mic, MicOff, PhoneOff, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VoiceConversationClient, type VoiceClientState } from "@/lib/voice-conversation-client";

type Props = {
  chatId: string | null; modelId: string; disabled?: boolean;
  onEnsureChat: () => Promise<string | null>;
  onTranscriptChange: (chatId: string) => void;
  onActiveChange?: (active: boolean) => void;
};

export function VoiceConversation({ chatId, modelId, disabled, onEnsureChat, onTranscriptChange, onActiveChange }: Props) {
  const [available, setAvailable] = useState(false);
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [state, setState] = useState<VoiceClientState>({ state: "idle", phase: "connecting", muted: false, playbackBlocked: false, inputLevel: 0, outputLevel: 0 });
  const [seconds, setSeconds] = useState(0);
  const client = useRef<VoiceConversationClient | null>(null);
  const callbacks = useRef({ onEnsureChat, onTranscriptChange, onActiveChange });
  callbacks.current = { onEnsureChat, onTranscriptChange, onActiveChange };
  const generation = useRef(0);
  const selection = useRef({ chatId, modelId });
  selection.current = { chatId, modelId };
  const mounted = useRef(true);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    setAvailable(false);
    if (!modelId) return () => abort.abort();
    void fetch("/api/voice/conversation?modelId=" + encodeURIComponent(modelId), { signal: abort.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!abort.signal.aborted && response.ok) { setAvailable(body.available === true); setLabel(body.connectionLabel || ""); }
      }).catch(() => {});
    return () => abort.abort();
  }, [modelId]);

  useEffect(() => {
    const current = client.current;
    if (current && (current.modelId !== modelId || current.chatId !== chatId)) {
      ++generation.current;
      current.disconnect();
      client.current = null;
      setStarting(false);
      setState((previous) => ({ ...previous, state: "idle" }));
      setOpen(false);
    }
  }, [chatId, modelId]);

  useEffect(() => {
    mounted.current = true;
    const hide = () => client.current?.disconnect(false);
    window.addEventListener("pagehide", hide);
    return () => {
      mounted.current = false;
      ++generation.current;
      client.current?.disconnect(false);
      callbacks.current.onActiveChange?.(false);
      window.removeEventListener("pagehide", hide);
    };
  }, []);

  const active = starting || state.state === "connecting" || state.state === "connected";
  useEffect(() => { callbacks.current.onActiveChange?.(active); }, [active]);
  useEffect(() => {
    if (state.state !== "connected") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state.state]);
  const transcripts = state.snapshot?.transcripts || [];
  const lastTranscript = transcripts.at(-1)?.text;
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: "nearest" }); }, [lastTranscript]);

  async function start() {
    const ticket = ++generation.current;
    client.current?.disconnect(false);
    setOpen(true);
    setSeconds(0);
    setStarting(true);
    setState({ state: "connecting", phase: "connecting", muted: false, playbackBlocked: false, inputLevel: 0, outputLevel: 0 });
    try {
      const id = chatId || await callbacks.current.onEnsureChat();
      if (ticket !== generation.current || !mounted.current) return;
      if (!id) throw new Error("Could not create a chat. Try again.");
      if (selection.current.modelId !== modelId || (selection.current.chatId && selection.current.chatId !== id)) { end(true); return; }
      const conversation = new VoiceConversationClient({ chatId: id, modelId }, (next) => {
        if (mounted.current && ticket === generation.current) setState(next);
      }, () => {
        if (mounted.current) callbacks.current.onTranscriptChange(id);
      });
      client.current = conversation;
      await conversation.connect();
    } catch (error) {
      if (mounted.current && ticket === generation.current) setState((previous) => ({ ...previous, state: "error", error: error instanceof Error ? error.message : "Could not start voice." }));
    } finally { if (mounted.current && ticket === generation.current) setStarting(false); }
  }

  function end(closeDialog: boolean) {
    ++generation.current;
    client.current?.disconnect();
    client.current = null;
    setStarting(false);
    setState((previous) => ({ ...previous, state: "idle", inputLevel: 0, outputLevel: 0, muted: false }));
    if (closeDialog) setOpen(false);
  }

  if (!available && !open) return null;
  const status = state.state === "error" ? "Could not connect"
    : active && state.phase === "permission" ? "Allow microphone access"
    : starting || state.state === "connecting" ? "Connecting…"
    : state.state === "idle" ? "Conversation ended"
    : state.phase === "speaking" ? "Metis is speaking"
    : state.muted ? "Microphone muted" : "Listening";
  const level = state.phase === "speaking" ? state.outputLevel : state.inputLevel;

  return <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 self-end rounded-full"
          aria-label={active ? "Return to voice conversation" : "Start voice conversation"}
          aria-pressed={active} disabled={Boolean(disabled && !active) || !available}
          onClick={() => { if (active) setOpen(true); else void start(); }}>
          <AudioLines className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{active ? "Return to voice conversation" : disabled ? "Finish your current recording or run first" : "Start voice conversation"}</TooltipContent>
    </Tooltip>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md" showCloseButton={!active}>
        <div className="relative border-b px-6 py-5">
          {active ? <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 size-11" aria-label="Minimize voice conversation" onClick={() => setOpen(false)}><ChevronDown /></Button> : null}
          <DialogTitle className="pr-10 text-lg">Talk to Metis</DialogTitle>
          <DialogDescription className="mt-2">{label ? label + " · " : ""}Your conversation stays in this chat.</DialogDescription>
        </div>
        <div className="px-6 py-7 text-center">
          <div className="flex h-20 items-center justify-center gap-1.5" aria-hidden="true">
            {Array.from({ length: 17 }, (_, index) => {
              const weight = 1 - Math.abs(index - 8) / 10;
              return <span key={index} className="w-1.5 rounded-full bg-foreground/70 transition-[height] duration-100 motion-reduce:transition-none"
                style={{ height: active ? 6 + level * weight * 68 : 6 }} />;
            })}
          </div>
          <p role="status" aria-live="polite" className="mt-5 text-base font-medium">{status}</p>
          <p className="mt-1.5 text-sm tabular-nums text-muted-foreground">
            {state.state === "connected" || state.state === "idle" ? Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : "You can interrupt at any time"}
          </p>
          {state.error && state.state === "error" ? <p role="alert" className="mt-4 text-sm text-destructive">{state.error}</p> : null}
          {state.playbackBlocked && active ? <Button type="button" variant="outline" className="mt-4 h-11" onClick={() => { void client.current?.enablePlayback(); }}><Volume2 />Enable audio</Button> : null}
        </div>
        {transcripts.length ? <div className="max-h-40 space-y-4 overflow-y-auto border-t px-6 py-4 text-sm" role="log" aria-label="Conversation transcript">
          {transcripts.map((transcript) => <div key={transcript.id}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{transcript.role === "user" ? "You" : "Metis"}</p>
            <p className="whitespace-pre-wrap break-words leading-relaxed">{transcript.text || "…"}</p>
          </div>)}
          <div ref={transcriptEnd} />
        </div> : null}
        <div className="flex justify-center gap-3 border-t bg-muted/30 px-6 py-5">
          {active ? <>
            <Button type="button" variant={state.muted ? "secondary" : "outline"} className="h-12 min-w-28 gap-2" disabled={state.state !== "connected"}
              aria-pressed={state.muted} onClick={() => client.current?.setMuted(!state.muted)}>
              {state.muted ? <MicOff /> : <Mic />}{state.muted ? "Unmute" : "Mute"}
            </Button>
            <Button type="button" variant="destructive" className="h-12 min-w-28 gap-2" onClick={() => end(false)}><PhoneOff />Hang up</Button>
          </> : <>
            <Button type="button" variant="outline" className="h-12 gap-2" disabled={!available || disabled} onClick={() => { void start(); }}><RotateCcw />{state.state === "error" ? "Try again" : "Call again"}</Button>
            <Button type="button" variant="ghost" className="h-12 min-w-24" onClick={() => end(true)}>Close</Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
