// The small structural subset used by this plugin; no extra runtime dependency.
type Node = {
  type: string; value?: string; tagName?: string;
  properties?: Record<string, unknown>; children?: Node[];
};
const excluded = new Set(["pre", "code", "svg", "math", "script", "style", "textarea"]);

/** Wrap only prose. Code, math and embedded renderers keep their own DOM. */
export default function rehypeStreamingText() {
  return (tree: Node) => {
    function walk(parent: Node) {
      const classes = parent.properties?.className;
      if (parent.type === "element" && (excluded.has(parent.tagName || "") ||
        (Array.isArray(classes) && classes.some(name => /katex|math-/.test(String(name)))))) return;
      if (!parent.children) return;
      parent.children = parent.children.map(child => {
        if (child.type === "text" && child.value?.trim()) return {
          type: "element", tagName: "span", properties: { "data-metis-stream-text": true }, children: [child],
        };
        if (child.type === "element") walk(child);
        return child;
      });
    }
    walk(tree);
  };
}
