import { QUESTION_ICONS } from "./mcp-core/question-schema.mjs";
const names = new Set(QUESTION_ICONS);
type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; data?: Record<string, unknown> };
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
    }
    visit(root as MarkdownNode);
  };
}
