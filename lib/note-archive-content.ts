import { unified } from "unified";
import remarkParse from "remark-parse";
import { z } from "zod";
import { readNotesRichBlock, type EditorNode } from "@/lib/notes-editor-format";

type MarkdownNode = {
  type: string; url?: string; lang?: string; value?: string; children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const parser = unified().use(remarkParse);
const fileBlockSchema = z.object({ url: z.string(), name: z.string(), mimeType: z.string() }).passthrough();
function fileBlock(source: string) {
  try { const parsed = fileBlockSchema.safeParse(JSON.parse(source)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}

export function replaceArchiveUrls(content: string, replacements: Map<string, string>) {
  const protectedRanges: Array<{ start: number; end: number }> = [];
  const visit = (node: MarkdownNode) => {
    if (["code", "inlineCode", "html"].includes(node.type)) {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
    } else for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(content) as MarkdownNode);
  const replace = (source: string) => {
    for (const [before, after] of [...replacements].sort((a, b) => b[0].length - a[0].length)) source = source.replaceAll(before, after);
    return source;
  };
  let output = "", offset = 0;
  for (const range of protectedRanges.sort((a, b) => a.start - b.start)) {
    output += replace(content.slice(offset, range.start)) + content.slice(range.start, range.end);
    offset = range.end;
  }
  return output + replace(content.slice(offset));
}
function richNodes(node: EditorNode, visit: (node: EditorNode) => void) {
  visit(node);
  for (const child of node.content ?? []) richNodes(child, visit);
}
function richUrls(node: EditorNode, visit: (value: string) => void) {
  richNodes(node, child => {
    const key = child.type === "image" ? "src" : child.type === "embedBlock" ? "url" : null;
    if (key && typeof child.attrs?.[key] === "string") visit(child.attrs[key] as string);
    for (const mark of child.marks ?? []) if (mark.type === "link" && typeof mark.attrs?.href === "string") visit(mark.attrs.href);
  });
}
export function archiveMarkdownUrls(content: string) {
  const urls = new Set<string>();
  const visit = (node: MarkdownNode) => {
    if (["link", "image", "definition"].includes(node.type) && node.url) urls.add(node.url);
    if (node.type === "code" && node.lang === "metis-block") {
      const rich = readNotesRichBlock(node.value ?? "");
      if (rich) richUrls(rich, value => urls.add(value));
    } else if (node.type === "code" && node.lang === "file") {
      const file = fileBlock(node.value ?? "");
      if (file) urls.add(file.url);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(content) as MarkdownNode);
  return urls;
}

/** Rewrite only recognized rich-node reference attributes; other source stays byte-for-byte. */
export function remapRichArchiveReferences(content: string, mapUrl: (value: string) => string, mapPage: (value: string) => string) {
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const visit = (node: MarkdownNode) => {
    let replacement: string | undefined;
    if (node.type === "code" && node.lang === "metis-block") {
      const rich = readNotesRichBlock(node.value ?? "");
      if (rich) {
        const before = JSON.stringify(rich);
        richNodes(rich, child => {
          if (child.type === "pageReference" && typeof child.attrs?.noteId === "string") child.attrs.noteId = mapPage(child.attrs.noteId);
          const key = child.type === "image" ? "src" : child.type === "embedBlock" ? "url" : null;
          if (key && typeof child.attrs?.[key] === "string") child.attrs[key] = mapUrl(child.attrs[key] as string);
          for (const mark of child.marks ?? []) if (mark.type === "link" && typeof mark.attrs?.href === "string") mark.attrs.href = mapUrl(mark.attrs.href);
        });
        if (JSON.stringify(rich) !== before) replacement = JSON.stringify(rich);
      }
    } else if (node.type === "code" && node.lang === "file") {
      const file = fileBlock(node.value ?? "");
      if (file && mapUrl(file.url) !== file.url) replacement = JSON.stringify({ ...file, url: mapUrl(file.url) });
    }
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (replacement !== undefined && start !== undefined && end !== undefined) {
      const source = content.slice(start, end);
      const body = source.indexOf(node.value ?? "");
      if (body >= 0) edits.push({ start: start + body, end: start + body + (node.value?.length ?? 0), value: replacement });
      else {
        // remark removes CRLF and container indentation from a code block's value.
        const firstLine = source.indexOf("\n"), lastLine = source.lastIndexOf("\n");
        const closing = source.slice(lastLine + 1);
        const prefix = /^([ \t>]*)(?:\x60{3,}|~{3,})[ \t]*$/.exec(closing)?.[1];
        if (firstLine >= 0 && lastLine > firstLine && prefix !== undefined) {
          const newline = source[firstLine - 1] === "\r" ? "\r\n" : "\n";
          edits.push({ start: start + firstLine + 1, end: start + lastLine + 1, value: prefix + replacement + newline });
        } else throw new Error("Cannot safely remap references in this rich Markdown source block.");
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(content) as MarkdownNode);
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
  return content;
}
