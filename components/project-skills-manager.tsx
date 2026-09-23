"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ProjectSkillItem = {
  id: string;
  title: string;
  description: string;
  source: string;
  enabled: boolean;
  alwaysOn: boolean;
};

function SkillRow({
  skill,
  enabled,
  onMove,
}: {
  skill: ProjectSkillItem;
  enabled: boolean;
  onMove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `project-skill:${skill.id}`,
    data: { skillId: skill.id, enabled },
  });

  return (
    <div
      ref={setNodeRef}
      data-project-skill-id={skill.id}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-lg border border-border/45 bg-background px-2.5 py-2.5",
        isDragging && "opacity-45",
      )}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
    >
      <button
        type="button"
        className="mt-0.5 inline-flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Drag ${skill.title}`}
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{skill.title}</span>
          {skill.alwaysOn ? (
            <span className="shrink-0 text-[10px] font-medium text-muted-foreground">Always on</span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
          {skill.description || skill.id}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 shrink-0"
        onClick={onMove}
        aria-label={enabled ? `Disable ${skill.title}` : `Enable ${skill.title}`}
        title={enabled ? "Move to disabled" : "Move to enabled"}
      >
        {enabled ? <ArrowLeft className="size-3.5" /> : <ArrowRight className="size-3.5" />}
      </Button>
    </div>
  );
}

function SkillColumn({
  id,
  title,
  description,
  skills,
  enabled,
  onMove,
}: {
  id: "disabled" | "enabled";
  title: string;
  description: string;
  skills: ProjectSkillItem[];
  enabled: boolean;
  onMove: (skillId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `project-skills:${id}` });

  return (
    <section
      ref={setNodeRef}
      data-project-skills-column={id}
      className={cn(
        "min-h-48 rounded-xl border border-border/55 bg-muted/15 p-3 transition-colors",
        isOver && "border-primary/55 bg-primary/[0.04]",
      )}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p>
        </div>
        <span className="tabular-nums text-xs text-muted-foreground">{skills.length}</span>
      </header>
      {skills.length ? (
        <div className="grid gap-2">
          {skills.map((skill) => (
            <SkillRow key={skill.id} skill={skill} enabled={enabled} onMove={() => onMove(skill.id)} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border/55 px-4 text-center text-xs leading-5 text-muted-foreground">
          Drop skills here
        </div>
      )}
    </section>
  );
}

export function ProjectSkillsManager({
  skills,
  disabledSkillIds,
  onChange,
}: {
  skills: ProjectSkillItem[];
  disabledSkillIds: string[];
  onChange: (disabledSkillIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const disabled = new Set(disabledSkillIds);
  const disabledSkills = skills.filter((skill) => disabled.has(skill.id));
  const enabledSkills = skills.filter((skill) => !disabled.has(skill.id));

  const move = (skillId: string, destination: "disabled" | "enabled") => {
    const next = new Set(disabledSkillIds);
    if (destination === "disabled") next.add(skillId);
    else next.delete(skillId);
    onChange([...next]);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const skillId = String(active.data.current?.skillId || "").trim();
    if (!skillId || !over) return;
    const destination = over.id === "project-skills:disabled"
      ? "disabled"
      : over.id === "project-skills:enabled"
        ? "enabled"
        : null;
    if (destination) move(skillId, destination);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid gap-3 lg:grid-cols-2">
        <SkillColumn
          id="disabled"
          title="Disabled"
          description="Unavailable to chats in this project."
          skills={disabledSkills}
          enabled={false}
          onMove={(skillId) => move(skillId, "enabled")}
        />
        <SkillColumn
          id="enabled"
          title="Enabled"
          description="Available to every chat in this project."
          skills={enabledSkills}
          enabled
          onMove={(skillId) => move(skillId, "disabled")}
        />
      </div>
    </DndContext>
  );
}
