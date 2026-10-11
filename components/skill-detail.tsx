"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Code2, FileText, Folder, Puzzle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SkillSettingsView } from "@/lib/skills";
import type { SkillFile } from "@/lib/skill-files";

type Preview = SkillFile & { content: string; mimeType?: string };
function FileTree({ files, selected, onSelect, prefix = "" }: { files: SkillFile[]; selected: string; onSelect: (path: string) => void; prefix?: string }) {
  const names = [...new Set(files.filter(file => file.path.startsWith(prefix)).map(file => file.path.slice(prefix.length).split("/")[0]))];
  return <ul className="space-y-0.5">{names.map(name => {
    const relative = prefix + name;
    const file = files.find(item => item.path === relative);
    return <li key={relative}>{file ? <button type="button" aria-current={selected === relative ? "page" : undefined}
      className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === relative && "bg-muted text-foreground")}
      title={relative} onClick={() => onSelect(relative)}>{/\.(py|js|ts|sh)$/.test(name) ? <Code2 className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}<span className="truncate">{name}</span></button>
      : <details open><summary className="flex min-h-9 cursor-pointer items-center gap-2 px-2 text-xs"><Folder className="size-3.5" />{name}</summary><div className="ml-3 border-l border-border pl-1"><FileTree files={files} selected={selected} onSelect={onSelect} prefix={relative + "/"} /></div></details>}</li>;
  })}</ul>;
}
export function SkillDetail({ skill, onBack, onChange, onTry }: { skill: SkillSettingsView; onBack: () => void; onChange: (id: string, flag: "enabledSkills" | "alwaysOnSkills", value: boolean) => Promise<void>; onTry: (skill: SkillSettingsView) => void }) {
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [selected, setSelected] = useState("SKILL.md");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/skills/" + encodeURIComponent(skill.id) + "/files", { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load skill files.");
      setFiles(body.files || []);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [skill.id]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null); setError("");
    fetch("/api/skills/" + encodeURIComponent(skill.id) + "/files?path=" + encodeURIComponent(selected), { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not read skill file.");
      setPreview(body); setLoading(false);
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setLoading(false); } });
    return () => controller.abort();
  }, [selected, skill.id]);
  async function toggle(flag: "enabledSkills" | "alwaysOnSkills", value: boolean) {
    setBusy(true); try { await onChange(skill.id, flag, value); } finally { setBusy(false); }
  }
  const markdown = preview?.path.endsWith(".md") ? preview.content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "") : "";
  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Skill details">
    <header className="space-y-4 border-b border-border px-5 py-4 sm:px-7">
      <Button variant="ghost" className="h-9 px-0 text-muted-foreground" onClick={onBack}><ArrowLeft /> All skills</Button>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><Puzzle className="mt-1 size-7 shrink-0" /><div className="min-w-0"><h3 className="break-words text-xl font-semibold">{skill.title}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{skill.sourceType === "bundled" ? "Included with Metis" : skill.source || "Custom skill"}</p></div></div>
      <Button disabled={!skill.enabled || busy} onClick={() => onTry(skill)}>Try in chat</Button></div>
    </header>
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[14rem_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Skill files" className="max-h-40 overflow-auto border-b border-border p-3 lg:max-h-none lg:border-b-0 lg:border-r"><FileTree files={files} selected={selected} onSelect={setSelected} /></nav>
      <div className="min-w-0 overflow-auto p-5 sm:p-7">
        {selected === "SKILL.md" ? <div className="mb-6 space-y-4 rounded-xl border border-border bg-background p-4">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]"><dt className="text-muted-foreground">Name</dt><dd>{skill.title}</dd><dt className="text-muted-foreground">Description</dt><dd className="break-words leading-relaxed">{skill.description || "No description provided."}</dd></dl>
          <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-3">
            <label className="flex items-center gap-3 text-sm"><Switch checked={skill.enabled} disabled={busy} aria-label={"Enable " + skill.title} onCheckedChange={value => void toggle("enabledSkills", value)} />Enabled</label>
            <label className="flex items-center gap-3 text-sm"><Switch checked={skill.alwaysOn} disabled={busy} aria-label={"Always on for " + skill.title} onCheckedChange={value => void toggle("alwaysOnSkills", value)} />Always on</label>
          </div><p className="text-xs text-muted-foreground">Enabled skills are available when a task matches. Always on adds this skill to every response.</p>
        </div> : <h4 className="mb-4 break-all font-mono text-sm">{selected}</h4>}
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading file…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {preview?.kind === "image" ? <img src={"data:" + preview.mimeType + ";base64," + preview.content} alt={preview.path} className="max-h-96 max-w-full object-contain" /> : markdown ? <div className="text-sm leading-6 break-words [&_h1]:mb-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_pre]:my-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/40 [&_pre]:p-4 [&_pre]:text-xs [&_code]:font-mono [&_a]:underline [&_blockquote]:border-l [&_blockquote]:pl-4"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
          const resolved = href ? selected.split("/").slice(0, -1).concat(href.split("/")).join("/") : "";
          return files.some(file => file.path === resolved) ? <button className="text-left underline" onClick={() => setSelected(resolved)}>{children}</button> : <a href={href?.startsWith("http") ? href : undefined} target="_blank" rel="noopener noreferrer">{children}</a>;
        } }}>{markdown}</ReactMarkdown></div> : preview?.kind === "text" ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{preview.content}</pre> : null}
      </div>
    </div>
  </section>;
}
