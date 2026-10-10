"use client";
import { Component, useEffect, useState, type ReactNode } from "react";
import { ProjectHome } from "@/components/project-home";
import { ProjectTeamWorkspace } from "@/components/project-team-workspace";
import { ProjectAgentChatHeader } from "@/components/project-agents-panel";
import { ToolCallGroup } from "@/components/tool-call-chip";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { projectQuestionTranscript } from "@/lib/question-transcript";
import type { ProjectAgent, ProjectHandoff } from "@/lib/project-team-types";

const stamp = new Date().toISOString();
const agents: ProjectAgent[] = [
  { id: "lead", projectId: "review-team", chatId: "chat-lead", name: "Coordinator", role: "Organisiert die Diagnose", systemPrompt: "", color: "#1767ed", createdAt: stamp, updatedAt: stamp, status: "running" },
  { id: "research", projectId: "review-team", chatId: "chat-research", name: "Research", role: "Prüft technische Ursachen", systemPrompt: "", color: "#079e6c", createdAt: stamp, updatedAt: stamp, status: "running", supervisorId: "lead" },
  { id: "review", projectId: "review-team", chatId: "chat-review", name: "Review", role: "Kontrolliert die Ergebnisse", systemPrompt: "", color: "#f87916", createdAt: stamp, updatedAt: stamp, status: "idle", supervisorId: "lead" },
];
const handoffs: ProjectHandoff[] = [
  { id: "handoff", projectId: "review-team", senderAgentId: "lead", recipientAgentId: "research", senderName: "Coordinator", recipientName: "Research", task: "Prüfe die Display-Konfiguration.", status: "running", createdAt: stamp, updatedAt: stamp },
  { id: "reply", projectId: "review-team", senderAgentId: "research", recipientAgentId: "review", senderName: "Research", recipientName: "Review", task: "Kontrolliere die Diagnose.", result: "Die Werte sind plausibel.", status: "completed", createdAt: stamp, updatedAt: stamp },
];
const transcript = projectQuestionTranscript([
  { id: "prompt", role: "user", content: "Prüfe die Einstellungen meines Monitors." },
  { id: "assistant", role: "assistant", content: "Welche Bildwiederholrate nutzt du?Danke. Ich prüfe jetzt die passende Konfiguration.", parts: [
    { type: "text", content: "Welche Bildwiederholrate nutzt du?" },
    { type: "tool", id: "ask", name: "ask_user", kind: "mcp" as const, status: "completed", result: '{"questionId":"monitor-question","answers":["144 Hz"]}' },
    { type: "text", content: "Danke. Ich prüfe jetzt die passende Konfiguration." },
  ] },
  { id: "question-answer-monitor-question", role: "user", content: "Mein Monitor läuft mit 144 Hz." },
]);
class ReviewBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.stack || error.message }; }
  render() { return this.state.error ? <pre>{this.state.error}</pre> : this.props.children; }
}
export function ProjectChatReview() { return <ReviewBoundary><ReviewContent /></ReviewBoundary>; }
function ReviewContent() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [overview, setOverview] = useState(true);
  useEffect(() => {
    const original = window.fetch;
    let project = { id: "review-team", name: "Display-Diagnose", mode: "agents", icon: "folder", color: "#1767ed", instructions: "", memoryMode: "default", disabledSkillIds: [], memories: [], allowAgentManagement: false, hideChatsFromAll: false };
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/projects/review-team/agents") return Response.json({ agents, handoffs });
      if (url === "/api/projects/review-team") {
        if (init?.method === "PATCH") project = { ...project, ...JSON.parse(String(init.body)) };
        return Response.json({ project, files: [], notes: [], chats: agents.map(a => ({ id: a.chatId, title: a.name })), skills: [] });
      }
      return original(input, init);
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, []);
  if (!ready) return <p>Loading review…</p>;
  return <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6">
    <div className="mb-4 flex items-center justify-between gap-3"><p className="text-sm font-medium">Metis AI · Display-Diagnose</p><Button variant="ghost" onClick={() => setSettings(!settings)}>{settings ? "Chat & Overview" : "Projekt-Einstellungen"}</Button></div>
    {settings ? <ProjectHome projectId="review-team" onOpenChat={() => setSettings(false)} onNewChat={() => {}} onAttachFile={() => {}} onOpenNotes={() => {}} onDeleted={() => {}} /> : <>
      <header className="mb-5"><ProjectAgentChatHeader projectId="review-team" chatId="chat-lead" fallbackTitle="Coordinator" onOpenTeam={() => setOverview(true)} /></header>
      <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 480px), 1fr))" }}>
        <section aria-label="Chat transcript" className="space-y-5 py-4">
          {transcript.map(message => <article key={message.id} data-message-id={message.id} className={message.role === "user" ? "flex justify-end" : "assistant-message-text text-[15px] leading-relaxed"}>
            {message.role === "user" ? <div className="max-w-[85%] rounded-2xl bg-secondary/50 px-4 py-2.5 text-[15px]"><Markdown content={message.content} /></div> : (message.parts ?? []).map((part, index) => part.type === "tool" ? <ToolCallGroup key={index} tools={[{ id: part.id!, name: part.name!, status: part.status!, kind: "mcp", result: part.result }]} /> : part.type === "text" ? <Markdown key={index} content={part.content || ""} /> : null)}
          </article>)}
        </section>
        {overview ? <div className="flex min-h-0 flex-col" style={{ height: 480 }}><ProjectTeamWorkspace projectId="review-team" chatId="chat-lead" onOpenChat={() => {}} /></div> : null}
      </div>
    </>}
  </main>;
}
