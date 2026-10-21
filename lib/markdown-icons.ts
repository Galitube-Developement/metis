import { QUESTION_ICONS } from "./mcp-core/question-schema.mjs";
const names = new Set(QUESTION_ICONS);
type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; data?: Record<string, unknown> };
// Split phrasing at authored line breaks, keeping formatting on both sides.
function iconLines(children: MarkdownNode[]): MarkdownNode[][] {
  const lines: MarkdownNode[][] = [[]];
  const append = (parts: MarkdownNode[][]) => {
    lines[lines.length - 1].push(...parts[0]);
    lines.push(...parts.slice(1));
  };
  for (const child of children) {
    if (child.type === "break") lines.push([]);
    else if (child.type === "text" && child.value?.includes("\n")) {
      append(child.value.split("\n").map(value => value ? [{ ...child, value }] : []));
    } else if (child.children && ["strong", "emphasis", "delete", "link", "linkReference"].includes(child.type)) {
      append(iconLines(child.children).map(parts => parts.length ? [{ ...child, children: parts }] : []));
    } else lines[lines.length - 1].push(child);
  }
  return lines;
}

function firstVisible(children: MarkdownNode[]): MarkdownNode | undefined {
  for (const child of children) {
    if (child.type === "text" && !child.value?.trim()) continue;
    const visible = child.children ? firstVisible(child.children) : child;
    if (visible) return visible;
  }
}

// Only icon-led lines get a gutter. Inline icons remain part of ordinary prose.
function indentIconLines(children: MarkdownNode[]): MarkdownNode[] {
  // Embedded images have their own block renderer; keep their paragraph structure intact.
  if (children.some(child => ["image", "imageReference", "html"].includes(child.type))) return children;
  const lines = iconLines(children);
  if (!lines.some(line => firstVisible(line)?.type === "metisIcon")) return children;
  return lines.map(line => {
    const icon = firstVisible(line);
    const leading = icon?.type === "metisIcon";
    if (leading) {
      icon.data = { ...icon.data, hProperties: {
        ...(icon.data?.hProperties as Record<string, unknown>),
        "data-metis-icon-leading": true,
      } };
    }
    return { type: "metisIconLine", children: line, data: {
      hName: "span", hProperties: { className: leading
        ? ["metis-icon-line", "metis-icon-indent"] : ["metis-icon-line"] },
    } };
  });
}

// Transform text leaves only: fenced code, inline code and raw HTML stay untouched.
export function remarkChatIcons() {
  return (root: unknown) => {
    function visit(node: MarkdownNode) {
      if (!node.children || ["code", "inlineCode", "html"].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const output: MarkdownNode[] = [];
        const source = child.value;
        let offset = 0;
        for (const match of source.matchAll(/\[icon:([a-z][a-z0-9-]*)\]/g)) {
          if (!names.has(match[1])) continue;
          if (match.index! > offset) output.push({ type: "text", value: source.slice(offset, match.index) });
          output.push({ type: "metisIcon", data: { hName: "span", hProperties: { "data-metis-icon": match[1] } } });
          offset = match.index! + match[0].length;
        }
        if (!offset) return [child];
        if (offset < source.length) output.push({ type: "text", value: source.slice(offset) });
        return output;
      });
      if (["paragraph", "heading", "tableCell"].includes(node.type)) node.children = indentIconLines(node.children);
    }
    visit(root as MarkdownNode);
  };
}
