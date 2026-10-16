"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Pipette, Search } from "lucide-react";
import { ProjectIconGlyph } from "@/components/project-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROJECT_COLORS, PROJECT_ICONS } from "@/lib/project-constants";
import { normalizeProjectColor, projectIconName, projectIconLabel, projectIconForeground, searchProjectIcons } from "@/lib/project-appearance";
import { cn } from "@/lib/utils";

export function ProjectColorPicker({ value, onChange, disabled = false }: {
  value: string; onChange: (color: string) => void; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(value); setError(false); }, [value]);
  function commit() {
    const color = normalizeProjectColor(draft);
    if (!color) { setError(true); return; }
    setDraft(color); setError(false);
    if (color !== value) onChange(color);
  }
  return <div className="grid gap-2">
    <p className="text-xs font-medium text-muted-foreground">Color</p>
    <div className="flex flex-wrap items-center gap-1 sm:gap-1.5" aria-label="Project color presets">
      {PROJECT_COLORS.map(color => <button key={color} type="button" disabled={disabled}
        aria-label={`Color ${color}`} aria-pressed={value.toLowerCase() === color}
        onClick={() => onChange(color)}
        className={cn("size-8 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
          value.toLowerCase() === color ? "border-foreground" : "border-transparent")}
        style={{backgroundColor: color}}/>)}
    <Popover>
      <PopoverTrigger asChild><button type="button" disabled={disabled} aria-label="Choose custom project color" title="Custom color" className="inline-flex size-8 items-center justify-center rounded-full border border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={!PROJECT_COLORS.includes(value.toLowerCase()) ? { backgroundColor: value, color: projectIconForeground(value) } : undefined}><Pipette className="size-4"/></button></PopoverTrigger>
      <PopoverContent align="end" className="w-64 max-w-[calc(100vw-2rem)] p-3" aria-label="Custom project color picker">
    <div className="flex items-center gap-2">
      <input type="color" value={normalizeProjectColor(value) || PROJECT_COLORS[0]}
        disabled={disabled} aria-label="Custom project color" title="Choose a custom color"
        onChange={event => { setError(false); onChange(event.target.value); }}
        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"/>
      <Input value={draft} disabled={disabled} maxLength={7} spellCheck={false} autoComplete="off"
        aria-label="Project color HEX" aria-invalid={error}
        placeholder="#6366f1" className="h-9 w-32 font-mono text-xs"
        onChange={event => { setDraft(event.target.value); setError(false); }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") { event.stopPropagation(); setDraft(value); setError(false); }
        }}/>
    </div>
    {error ? <p role="alert" className="text-xs text-destructive">Enter a HEX color such as #6366f1.</p> : null}
      </PopoverContent>
    </Popover>
    </div>
  </div>;
}

export function ProjectIconPicker({ value, color, onChange, disabled = false }: {
  value: string; color?: string; onChange: (icon: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(60);
  const list = useRef<HTMLDivElement>(null);
  const selected = projectIconName(value);
  const matches = useMemo(() => {
    const names = searchProjectIcons(query);
    if (query.trim()) return names;
    const first = [selected, ...PROJECT_ICONS.map(projectIconName)].filter((name): name is string => !!name);
    return [...new Set([...first, ...names])];
  }, [query, selected]);
  const shown = matches.slice(0, limit);
  function choose(name: string) { onChange("lucide:" + name); setOpen(false); }
  return <div className="grid gap-2">
    <p className="text-xs font-medium text-muted-foreground">Icon</p>
    <div className="flex flex-wrap items-center gap-1 sm:gap-1.5" aria-label="Project icon presets">
    {PROJECT_ICONS.map(icon => <button key={icon} type="button" disabled={disabled} aria-label={`Icon ${projectIconLabel(icon)}`} aria-pressed={selected === projectIconName(icon)} title={projectIconLabel(icon)} onClick={() => onChange(icon)}
      className={cn("inline-flex size-8 items-center justify-center rounded-md border border-transparent hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", selected === projectIconName(icon) && "border-foreground/30 bg-muted")}>
      <ProjectIconGlyph icon={icon} className="size-4"/>
    </button>)}
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setQuery(""); setLimit(60); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} aria-label="Choose project icon" title={`Custom icon · ${projectIconLabel(value)}`} aria-haspopup="dialog" aria-pressed={!PROJECT_ICONS.some(icon => projectIconName(icon) === selected)}
          className="relative size-8 shrink-0 p-0 aria-pressed:border-foreground/30 aria-pressed:bg-muted">
          <MoreHorizontal className="size-4"/>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-3"
        style={{maxHeight: "min(28rem, var(--radix-popover-content-available-height))"}} aria-label="Project icon library">
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true"/>
          <Input value={query} autoFocus placeholder="Search icons…" aria-label="Search project icons"
            className="h-9 pl-9" onChange={event => { setQuery(event.target.value); setLimit(60); list.current?.scrollTo(0, 0); }}
            onKeyDown={event => {
              if (event.key === "Enter" && matches.length) { event.preventDefault(); choose(matches[0]); }
              if (event.key === "ArrowDown") { event.preventDefault(); list.current?.querySelector("button")?.focus(); }
            }}/>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">{matches.length} {matches.length === 1 ? "icon" : "icons"}</p>
        <div ref={list} className="min-h-0 overflow-y-auto overscroll-contain" style={{maxHeight: "16rem"}}>
          {shown.length ? <div className="grid grid-cols-5 gap-1 sm:grid-cols-6">
            {shown.map(name => <button key={name} type="button" title={projectIconLabel("lucide:" + name)}
              aria-label={`Select ${projectIconLabel("lucide:" + name)}`} aria-pressed={selected === name}
              onClick={() => choose(name)}
              className={cn("relative flex min-h-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected === name && "bg-muted ring-1 ring-inset ring-foreground/20")}>
              <ProjectIconGlyph icon={"lucide:" + name} className="size-5"/>
              {selected === name ? <Check className="absolute bottom-1 right-1 size-2.5 text-muted-foreground" aria-hidden="true"/> : null}
            </button>)}
          </div> : <p className="py-6 text-center text-sm text-muted-foreground">No icons found. Try another name.</p>}
          {matches.length > shown.length ? <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => setLimit(current => current + 60)}>Show more icons</Button> : null}
        </div>
      </PopoverContent>
    </Popover>
    </div>
  </div>;
}
