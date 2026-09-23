"use client";

export type SkillFactsData = {
  id: string;
  title: string;
  description: string;
  source: string;
  sourceType?: string;
  skillPath?: string;
  license?: string;
  category?: string;
  tags?: string[];
  alwaysOn?: boolean;
};

function factRows(skill: SkillFactsData) {
  return [
    ["ID", skill.id],
    skill.source ? ["Source", skill.source] : null,
    skill.sourceType ? ["Type", skill.sourceType] : null,
    skill.skillPath ? ["Path", skill.skillPath] : null,
    skill.category ? ["Category", skill.category] : null,
    skill.tags?.length ? ["Tags", skill.tags.join(", ")] : null,
    skill.license ? ["License", skill.license] : null,
    skill.alwaysOn != null
      ? ["Activation", skill.alwaysOn ? "Always on — injected into every chat" : "Match-based — used when the task matches"]
      : null,
  ].filter((row): row is [string, string] => Boolean(row?.[0] && row?.[1]));
}

export function SkillFacts({
  skill,
  showDescription = true,
}: {
  skill: SkillFactsData;
  showDescription?: boolean;
}) {
  const rows = factRows(skill);
  return (
    <div data-slot="skill-facts" className="grid gap-2">
      {showDescription && skill.description ? (
        <p className="text-xs leading-5 text-muted-foreground">{skill.description}</p>
      ) : null}
      {rows.length ? (
        <dl className="grid gap-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px] leading-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-all text-foreground/85">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
