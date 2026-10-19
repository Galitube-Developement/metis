/** Internal document links. Content access is checked by the preview API. */
export type InternalLinkKind = "plan" | "canvas" | "note" | "automation";
export type InternalLinkTarget = { kind: InternalLinkKind; id: string };
export type InternalLinkPreview = InternalLinkTarget & {
  title: string;
  description: string;
  details: Array<{ label: string; value: string }>;
};

export function parseInternalLink(href: string | undefined): InternalLinkTarget | null {
  if (!href) return null;
  const workspace = /^workspace:\/\/(plan|canvas)\/([^/?#]+)(?:[?#].*)?$/i.exec(href);
  const item = /^(note|automation):\/\/([^/?#]+)(?:[?#].*)?$/i.exec(href);
  const match = workspace || item;
  if (!match) return null;
  let id: string;
  try { id = decodeURIComponent(match[2]); } catch { return null; }
  if (!id.trim() || /[\u0000-\u001f\u007f/\\]/.test(id)) return null;
  return { kind: match[1].toLowerCase() as InternalLinkKind, id };
}

export function internalLinkNavigation(target: InternalLinkTarget) {
  if (target.kind === "plan" || target.kind === "canvas") {
    return { href: `#workspace-${encodeURIComponent(target.id)}`, event: "ai-chat:open-workspace", detail: { type: target.kind, id: target.id } };
  }
  return {
    href: `#${target.kind}-${encodeURIComponent(target.id)}`,
    event: target.kind === "note" ? "ai-chat:open-note" : "ai-chat:open-automations",
    detail: { id: target.id },
  };
}
