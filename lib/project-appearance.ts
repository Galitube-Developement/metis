import { PROJECT_ICON_NAMES } from "@/lib/project-icon-names";

const iconNames = new Set(PROJECT_ICON_NAMES);
const legacyIcons: Record<string, string> = {
  folder: "folder-kanban", briefcase: "briefcase", code: "code-xml",
  sparkles: "sparkles", book: "book", flask: "flask-conical", rocket: "rocket", palette: "palette",
};

/** Namespaced selections keep old folder/code/flask meanings intact. */
export function projectIconName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.startsWith("lucide:") ? value.slice(7) : legacyIcons[value] || value;
  return iconNames.has(name) ? name : null;
}

export function isProjectIcon(value: unknown): value is string {
  return projectIconName(value) !== null;
}

export function projectIconLabel(value: string): string {
  const name = projectIconName(value) || "folder-kanban";
  return name.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function searchProjectIcons(query: string): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean).map(term => term.replace(/[-_]/g, ""));
  return PROJECT_ICON_NAMES.filter(name => terms.every(term => name.replace(/-/g, "").includes(term)));
}

export function normalizeProjectColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  if (/^[a-f0-9]{6}$/i.test(hex)) return "#" + hex.toLowerCase();
  if (/^[a-f0-9]{3}$/i.test(hex)) return "#" + hex.split("").map(char => char + char).join("").toLowerCase();
  return null;
}

/** Keep glyphs legible on light custom colors while preserving the usual white icons. */
export function projectIconForeground(color: string): string {
  const normalized = normalizeProjectColor(color);
  if (!normalized) return "#ffffff";
  const rgb = [1, 3, 5].map(start => parseInt(normalized.slice(start, start + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return 1.05 / (luminance + 0.05) >= 3 ? "#ffffff" : "#000000";
}
