"use client";
import { BookOpen, FilePenLine, Terminal, Wrench } from "lucide-react";
import { AnimatedNumber } from "./animated-number";
import { RunStatus } from "./run-status";
import { activityRowClass } from "./thinking-block";
import { toolPreparationTitle, toolPreparationCharacters, toolPreparationIdentity, toolPreparationLabel, type PreparingTool } from "@/lib/tool-preparation";
export { toolPreparationLabel } from "@/lib/tool-preparation";

export function ToolPreparationDetails({ name, kind, source, characters }: {
  name: string; kind?: string; source?: PreparingTool["source"]; characters?: number;
}) {
  const title = toolPreparationTitle({ name, kind, source });
  const count = toolPreparationCharacters(characters);
  const identity = toolPreparationIdentity({ name, kind, source });
  return <>
    <span className="min-w-0 truncate" title={title}>
      {identity ? <>{identity}<span className="opacity-70"> · {toolPreparationLabel(kind)}</span></> : title}
    </span>
    {count !== undefined ? <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
      <AnimatedNumber value={count}/> chars
    </span> : null}
  </>;
}

/** Arguments are still being written; execution has not started yet. */
export function ToolInputStatus({ name, kind, source, characters }: {
  name: string; kind?: string; source?: PreparingTool["source"]; characters?: number;
}) {
  const Icon = kind === "read" ? BookOpen : kind === "shell" ? Terminal : kind === "edit" ? FilePenLine : Wrench;
  return <div className={activityRowClass + " min-w-0"} data-tool-phase="preparing">
    <RunStatus status="running" decorative iconOnly className="shrink-0 text-xs"/>
    <Icon aria-hidden="true" className="size-3 shrink-0 opacity-70"/>
    <ToolPreparationDetails name={name} kind={kind} source={source} characters={characters}/>
  </div>;
}
