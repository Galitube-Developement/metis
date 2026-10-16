import { decodeString } from "micromark-util-decode-string";

type Node = {
  type: string; value?: string; tagName?: string;
  properties?: Record<string, unknown>; children?: Node[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};
const excluded = new Set(["pre", "code", "svg", "math", "script", "style", "textarea"]);

/** Fade only appended prose, preserving source boundaries when Markdown reparses. */
export default function rehypeStreamingText(options: { from?: number; born?: number; source?: string } = {}) {
  return (tree: Node) => {
    function walk(parent: Node) {
      const classes = parent.properties?.className;
      if (parent.type === "element" && (excluded.has(parent.tagName || "") ||
        (Array.isArray(classes) && classes.some(name => /katex|math-/.test(String(name)))))) return;
      if (!parent.children) return;
      parent.children = parent.children.map(child => {
        if (child.type === "text" && child.value?.trim()) {
          const start = child.position?.start?.offset;
          const end = child.position?.end?.offset;
          const from = options.from ?? 0;
          const oldSource = options.source !== undefined && start !== undefined
            ? options.source.slice(start, Math.min(end ?? start + child.value.length, Math.max(start, from)))
            : "";
          const oldLength = options.source !== undefined && start !== undefined
            ? decodeString(oldSource).replace(/\r\n?/g, "\n").length
            : Math.max(0, from - (start ?? 0));
          return { type: "element", tagName: "span", properties: {
            "data-metis-stream-text": true, "data-metis-stream-from": Math.min(child.value.length, oldLength),
            ...(options.born !== undefined ? { "data-metis-stream-born": options.born } : {}),
          }, children: [child] };
        }
        if (child.type === "element") walk(child);
        return child;
      });
    }
    walk(tree);
  };
}
