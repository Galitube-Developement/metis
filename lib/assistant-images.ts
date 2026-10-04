import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { defaultUrlTransform } from "react-markdown";

export interface AssistantImage { src: string; alt: string }
interface Node {
  type: string;
  url?: string;
  alt?: string;
  identifier?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
const parser = unified().use(remarkParse).use(remarkGfm);

/** Parse Markdown so code examples and reference images retain their meaning. */
export function extractAssistantImages(content: string) {
  const tree = parser.parse(content) as Node;
  const definitions = new Map<string, string>();
  const walk = (node: Node, visit: (node: Node) => void) => {
    visit(node);
    node.children?.forEach((child) => walk(child, visit));
  };
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toUpperCase(), node.url);
  });
  const images: AssistantImage[] = [];
  const ranges: [number, number][] = [];
  walk(tree, (node) => {
    if (node.type !== "image" && node.type !== "imageReference") return;
    const url = node.url ?? definitions.get(node.identifier?.toUpperCase() ?? "");
    const src = url ? defaultUrlTransform(url) : "";
    if (!src) return;
    images.push({ src, alt: node.alt || "Image" });
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) ranges.push([start, end]);
  });
  let text = content;
  for (const [start, end] of ranges.reverse()) text = text.slice(0, start) + text.slice(end);
  return { content: text, images };
}

export function uniqueAssistantImages(images: AssistantImage[]) {
  return images.filter((image, index) => images.findIndex((item) => item.src === image.src) === index);
}
