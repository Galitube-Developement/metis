import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { readNotesRichBlock, type EditorNode } from "./notes-editor-format";

export type NotesHeading = { id: string; title: string; level: number; sourceOffset: number; path?: string };
type HeadingAst = { type: string; value?: string; alt?: string; depth?: number; lang?: string; children?: HeadingAst[]; position?: {start:{offset?:number}} };
const parser = unified().use(remarkParse).use(remarkGfm);
const text = (node: HeadingAst): string => node.value || node.alt || (node.children || []).map(text).join("");
export function collectNotesMarkdownHeadings(source: string): NotesHeading[] {
  const result: NotesHeading[] = [];
  const rich = (node: EditorNode, offset: number, path: number[] = []) => {
    if (node.type === "heading") {
      const title = (node.content || []).map((child) => child.text || (child.type === "inlineMath" ? String(child.attrs?.latex || "") : "")).join("");
      result.push({ id: node.attrs?.blockId ? "block-" + node.attrs.blockId : "notes-heading-" + offset + "-" + (path.join("-") || "rich"), title, level:Number(node.attrs?.level) || 1, sourceOffset:offset, path:path.join(".") });
    }
    (node.content || []).forEach((child,index) => rich(child,offset,[...path,index]));
  };
  const walk = (node: HeadingAst) => {
    const offset = node.position?.start.offset || 0;
    if (node.type === "heading") result.push({id:"notes-heading-" + offset,title:text(node),level:node.depth || 1,sourceOffset:offset});
    if (node.type === "code" && node.lang === "metis-block") { const parsed = readNotesRichBlock(node.value || ""); if (parsed) rich(parsed,offset); }
    (node.children || []).forEach(walk);
  };
  walk(parser.parse(source) as HeadingAst);
  return result;
}
