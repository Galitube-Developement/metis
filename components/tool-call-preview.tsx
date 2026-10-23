"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";
import { PlanWorkspaceCard } from "@/components/plan-workspace-card";
import { CanvasWorkspaceCard } from "@/components/canvas-workspace-card";
import { AutomationCard } from "@/components/automation-card";
import { planLooksParallelizable } from "@/lib/modes";
import { parseAutomationCard } from "@/lib/tool-kind";
import { canvasFromToolPayload, hydrateCanvasPreview, isToolRunning, memoryCardFromPayload, planFromToolPayload, unwrapToolRecord } from "@/lib/tool-call-display";
import type { ToolCallData } from "@/components/tool-call-chip";

type Plan = { title: string; content: string; workspaceLink?: string };
type Props = {
  tool: Pick<ToolCallData, "name" | "kind" | "input" | "result" | "detail" | "status" | "todos">;
  workspaces?: Array<{ id: string; type?: string; name?: string; content?: string }>;
  onOpenWorkspace?: () => void;
  onBuildPlan?: (plan: Plan, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  onNavigate?: () => void;
};

/** Rich tool-specific content lives inside the shared row's details popover. */
export function ToolCallPreview({ tool, workspaces, onOpenWorkspace, onBuildPlan, buildDisabled, onNavigate }: Props) {
  const { name, kind, input, result, detail, status, todos } = tool;
  const running = isToolRunning(status) && result === undefined;
  const payload = unwrapToolRecord(result);
  const failed = /^(error|failed|declined|canceled|cancelled)$/i.test(status) || Boolean(payload?.isError || payload?.error);
  if (kind === "todo" && todos) {
    const completed = todos.filter(todo => /^(completed|done)$/i.test(todo.status || "")).length;
    return <section aria-label="Task checklist" className="mb-3 border-b border-border pb-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-medium">{failed ? "Requested tasks" : "Tasks"}</h3>
        <span className="tabular-nums text-muted-foreground">{completed}/{todos.length}</span>
      </div>
      <ul className="space-y-2">{todos.map((todo, index) => {
        const done = /^(completed|done)$/i.test(todo.status || "");
        const active = /^(in_progress|running)$/i.test(todo.status || "");
        const Icon = done ? Check : active ? LoaderCircle : Circle;
        return <li key={todo.id || index} className="flex items-start gap-2">
          <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className={done ? "min-w-0 break-words text-muted-foreground line-through" : "min-w-0 break-words"}>{todo.content}<span className="sr-only"> — {todo.status || "pending"}</span></span>
        </li>;
      })}</ul>
      {!todos.length && <p className="text-muted-foreground">No tasks.</p>}
    </section>;
  }
  if (kind === "memory") {
    const memory = memoryCardFromPayload(name, input || detail, result, running ? "running" : status);
    return <section aria-label="Memory details" className="mb-3 border-b border-border pb-3">
      <h3 className="mb-1 font-medium">{memory.title}</h3>
      <p className="whitespace-pre-wrap break-words">{memory.body}</p>
    </section>;
  }
  if (running || failed) return null;
  if (kind === "plan") {
    const plan = planFromToolPayload(input, result, detail);
    return plan ? <PlanWorkspaceCard {...plan} onOpen={onOpenWorkspace}
      onBuild={() => onBuildPlan?.(plan)}
      onBuildWithAgents={() => onBuildPlan?.(plan, { multiAgent: true })}
      showMultiAgent={planLooksParallelizable(plan.content)} buildDisabled={buildDisabled} compact /> : null;
  }
  if (kind === "canvas") {
    const canvas = hydrateCanvasPreview(canvasFromToolPayload(input, result, detail), workspaces);
    return canvas ? <CanvasWorkspaceCard {...canvas} onOpen={onOpenWorkspace} /> : null;
  }
  const automation = parseAutomationCard(name, result, input, detail);
  return automation ? <AutomationCard {...automation} onOpen={() => {
    onNavigate?.();
    window.dispatchEvent(new CustomEvent("ai-chat:open-automations", { detail: { id: automation.id } }));
  }} /> : null;
}
