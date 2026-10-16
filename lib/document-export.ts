import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

export type DocumentExportFormat = "md" | "txt" | "pdf";

export function documentExportName(name: string, format: DocumentExportFormat) {
  const stem = name.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/\.(md|txt|pdf)$/i, "").replace(/[. ]+$/g, "").trim().slice(0, 120);
  return (stem || "document") + "." + format;
}

const parser = unified().use(remarkParse).use(remarkGfm);
type Node = { type: string; children?: Node[]; value?: string; url?: string; alt?: string | null; ordered?: boolean | null; start?: number | null; checked?: boolean | null; identifier?: string };

function plainNode(node: Node, depth = 0): string {
  const item = node;
  const children = () => (item.children || []).map((child) => plainNode(child, depth)).join("");
  switch (item.type) {
    case "root": return (item.children || []).map((child) => plainNode(child, depth)).join("\n\n");
    case "text": case "inlineCode": case "code": return item.value || "";
    case "html": return item.value || "";
    case "break": return "\n";
    case "thematicBreak": return "———";
    case "image": return item.alt || "Image";
    case "link": return children() + (item.url && item.url !== children() ? " (" + item.url + ")" : "");
    case "definition": return (item.identifier || "") + ": " + (item.url || "");
    case "footnoteReference": return "[" + item.identifier + "]";
    case "footnoteDefinition": return "[" + item.identifier + "] " + children();
    case "blockquote": return (item.children || []).map((child) => plainNode(child, depth)).join("\n\n").split("\n").map((line) => "> " + line).join("\n");
    case "list": return (item.children || []).map((child, index) => {
      const listItem = child as typeof item;
      const marker = item.ordered ? String((item.start ?? 1) + index) + ". " : "• ";
      const task = typeof listItem.checked === "boolean" ? (listItem.checked ? "[x] " : "[ ] ") : "";
      const text = (listItem.children || []).map((part) => plainNode(part, depth + 1)).join("\n");
      return marker + task + text.replace(/\n/g, "\n  ");
    }).join("\n");
    case "table": return (item.children || []).map((row) => plainNode(row, depth)).join("\n");
    case "tableRow": return (item.children || []).map((cell) => plainNode(cell, depth)).join(" | ");
    default: return children();
  }
}

export function markdownPlainText(content: string) {
  return plainNode(parser.parse(content)).trimEnd();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Raw HTML is dropped; images become captions so exports never fetch private/external assets. */
export async function documentExportHtml(name: string, content: string) {
  const html = String(await unified().use(remarkParse).use(remarkGfm)
    .use(remarkRehype, { handlers: {
      link: (state, node) => ({ type: "element",
        tagName: /^(https?:|mailto:|#)/i.test(node.url) ? "a" : "span",
        properties: /^(https?:|mailto:|#)/i.test(node.url) ? { href: node.url } : {},
        children: state.all(node),
      }),
      linkReference: (state, node) => {
        const url = state.definitionById.get(node.identifier)?.url || "";
        return { type: "element", tagName: /^(https?:|mailto:|#)/i.test(url) ? "a" : "span",
          properties: /^(https?:|mailto:|#)/i.test(url) ? { href: url } : {}, children: state.all(node) };
      },
      imageReference: (_state, node) => ({ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: node.alt || "Image" }] }),
      image: (_state, node) => ({ type: "element", tagName: "p", properties: { className: ["image-caption"] }, children: [{ type: "text", value: node.alt || "Image" }] }),
    } }).use(rehypeStringify).process(content));
  const first = parser.parse(content).children[0];
  const titleAlreadyPresent = first?.type === "heading" && plainNode(first).trim() === name.trim();
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(name)}</title><style>
    @page { size: A4; }
    * { box-sizing: border-box; }
    body { color: #18202b; background: white; font: 11pt/1.6 Arial, sans-serif; overflow-wrap: anywhere; }
    h1 { font-size: 24pt; line-height: 1.2; margin: 0 0 22px; }
    h2 { font-size: 17pt; margin-top: 26px; }
    h3 { font-size: 13pt; margin-top: 20px; }
    h1,h2,h3,h4,h5,h6 { break-after: avoid; }
    p { margin: 0 0 12px; }
    a { color: #18202b; text-decoration: underline; }
    blockquote { border-left: 3px solid #d0d5db; padding-left: 14px; margin-left: 0; color: #46505c; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #f3f4f6; border: 1px solid #dde1e6; }
    code { font: 9pt/1.5 "DejaVu Sans Mono", monospace; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 16px 0; font-size: 10pt; }
    th,td { border: 1px solid #d0d5db; padding: 7px 9px; vertical-align: top; }
    th { text-align: left; background: #f3f4f6; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    .contains-task-list { list-style: none; padding-left: 4px; }
    input[type=checkbox] { margin-right: 7px; }
    .image-caption { color: #59636f; font-style: italic; }
  </style></head><body>${titleAlreadyPresent ? "" : "<h1>" + escapeHtml(name) + "</h1>"}${html}</body></html>`;
}
