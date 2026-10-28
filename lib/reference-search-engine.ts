import { getGlobalModelSettings, listChatsForUser, listMemories } from "@/lib/db-store";
import { listAccessibleIssues } from "@/lib/issues";
import { issueReference } from "@/lib/issue-types";
import { listProjects } from "@/lib/projects";
import { featureFlags } from "@/lib/feature-flags";
import { config } from "@/lib/config";
import { listNotes } from "@/lib/shared-context";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { referenceMatches, type ReferenceKind } from "@/lib/reference-search";
import { indexedReferenceFiles,indexedChatMetadata } from "./reference-file-index";
import { getDatabase } from "./sqlite";
import type { ReferenceResult } from "./reference-search";
import { canAccessChat } from "@/lib/project-access";

export async function collectReferences(input: {ownerId:string; query:string; kind?:ReferenceKind|null; currentChatId:string}, cancelled:()=>boolean, schedule:(chatId:string,title:string)=>void=()=>{}) {
  const {ownerId,query,kind,currentChatId}=input;
  const check=()=>{if(cancelled()) throw Object.assign(new Error("Search cancelled"),{name:"AbortError"});};
  const results: ReferenceResult[] = [];
  let indexing=false;
  const seen = new Set<string>();

  const push = (item: ReferenceResult) => {
    if ((!kind || item.kind === kind) && referenceMatches(query, item.label, item.detail, item.path, item.content)) {
      const key = item.kind === "file" ? [item.kind,item.chatId,item.path].join(":") : [item.kind,item.id,item.chatId || ""].join(":");
      if(seen.has(key))return;
      if(results.length>=80) {
        if(!item.isCurrentChat)return;
        const index=results.findLastIndex(result=>!result.isCurrentChat);
        if(index<0)return;
        results.splice(index,1);
      }
      seen.add(key); results.push(item);
    }
  };

  const chatEntries = kind === "note" || kind === "memory" || kind === "issue" ? [] : listChatsForUser(ownerId);
  chatEntries.sort((a,b)=>Number(b.id===currentChatId)-Number(a.id===currentChatId));
  for (const entry of chatEntries) {
    check();
    if(results.length>=80) break;
    await new Promise<void>(resolve=>setImmediate(resolve));
    if (kind === "chat") {
      push({ kind: "chat", id: entry.id, label: entry.title || "Untitled chat", detail: entry.keywords?.join(" · "), chatId: entry.id, isCurrentChat: entry.id === currentChatId });
      continue;
    }
    const projection = indexedChatMetadata(getDatabase(),entry,ownerId,schedule);
    indexing=projection.indexing||indexing;
    const chat=projection.chat;
    push({
      kind: "chat",
      id: chat.id,
      label: chat.title || "Untitled chat",
      detail: `${chat.keywords?.join(" · ") || ""}`,
      chatId: chat.id,
      isCurrentChat: chat.id === currentChatId,
    });

    for (const workspace of chat.workspaces || []) {
      push({
        kind: workspace.type,
        id: workspace.id,
        label: workspace.name,
        detail: `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        content: workspace.content.slice(0, 6_000),
      });
    }

    for (const tab of chat.browserContext?.tabs || []) {
      if (!tab.url && tab.title === "New tab") continue;
      push({
        kind: "browser",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || tab.url || "Browser tab",
        detail: tab.url || `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.url,
      });
    }

    for (const tab of chat.sessionState?.terminalTabs || []) {
      push({
        kind: "terminal",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || "Terminal",
        detail: `${tab.cwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.cwd,
        sessionId: tab.sessionId,
      });
    }
    if (!chat.sessionState?.terminalTabs?.length && chat.sessionState?.terminalSessionId) {
      push({
        kind: "terminal",
        id: `${chat.id}:terminal-1`,
        label: "Terminal 1",
        detail: `${chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd,
        sessionId: chat.sessionState.terminalSessionId,
      });
    }

    if (kind && kind !== "file") continue;
    indexing=indexedReferenceFiles(getDatabase(), chat.id, chat.title || "Untitled chat", query, item=>push({...item,isCurrentChat:chat.id===currentChatId}), ()=>results.length>=80, schedule)||indexing;
  }

  check();
  if (!kind || kind === "memory") {
    for (const memory of listMemories(ownerId)) {
      push({
        kind: "memory",
        id: memory.id,
        label: memory.content.slice(0, 160),
        detail: memory.tags?.join(" · "),
        content: memory.content,
      });
    }
  }

  if (!kind || kind === "note" || kind === "memory") {
    for (const note of listNotes({ ownerId })) {
      if (note.chatId && !canAccessChat(note.chatId, ownerId)) continue;
      push({
        kind: note.kind === "learned_fact" ? "memory" : "note",
        id: note.id,
        label: noteDisplayTitle(note.title) || note.content.slice(0, 80) || "Untitled note",
        detail: note.projectId ? "Project context" : note.chatId ? "Chat context" : note.scope === "workspace" ? "Workspace context" : "Global context",
        ...(note.chatId ? { chatId: note.chatId, isCurrentChat: note.chatId === currentChatId } : {}),
        content: note.content.slice(0, 6_000),
      });
    }
  }

  if ((!kind || kind === "issue") && featureFlags(getGlobalModelSettings(ownerId)).notes) {
    const projects = new Map(listProjects(ownerId).map(project => [project.id, project.name]));
    for (const issue of listAccessibleIssues(ownerId)) push(issueReference(issue, issue.projectId ? projects.get(issue.projectId) : undefined));
  }

  check();
  // Membership can change while extraction yields; never return revoked chat data.
  return {results:results.filter(item=>!item.chatId || canAccessChat(item.chatId,ownerId)).sort((a,b)=>Number(Boolean(b.isCurrentChat))-Number(Boolean(a.isCurrentChat))),indexing};
}
