import { parseFileEmbed } from "@/lib/file-types";
/** Small source edits used by the live Markdown preview. */

export function minimalMarkdownChange(current: string, next: string) {
  if (current === next) return null;
  let from = 0;
  const commonLength = Math.min(current.length, next.length);
  while (from < commonLength && current[from] === next[from]) from += 1;
  let currentEnd = current.length;
  let nextEnd = next.length;
  while (currentEnd > from && nextEnd > from && current[currentEnd - 1] === next[nextEnd - 1]) {
    currentEnd -= 1;
    nextEnd -= 1;
  }
  return { from, to: currentEnd, insert: next.slice(from, nextEnd) };
}
export function toggleMarkdownTask(value: string, index: number, checked: boolean): string {
  let taskIndex = 0;
  let fenceChar = "";
  let fenceLength = 0;
  return value.split("\n").map((line) => {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!fenceChar) {
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        fenceChar = "";
        fenceLength = 0;
      }
      return line;
    }
    if (fenceChar) return line;
    const task = line.match(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/);
    if (!task || taskIndex++ !== index) return line;
    return task[1] + (checked ? "x" : " ") + task[3] + line.slice(task[0].length);
  }).join("\n");
}

export function replaceEmbeddedSource(
  value: string,
  kind: "chart" | "graph" | "mermaid" | "file",
  index: number,
  source: string,
): string {
  let seen = 0;
  const pattern = /^([ \t]*)(`{3,})(chart|graph|mermaid|file)[ \t]*\r?\n([\s\S]*?)^\1\2[ \t]*$/gm;
  return value.replace(pattern, (block, indent: string, fence: string, language: string, previous: string) => {
    if (language !== kind || (kind === "file" && !parseFileEmbed(previous)) || seen++ !== index) return block;
    if (kind === "file" && !source) return "";
    const nextSource = source.replace(/\n$/, "");
    if (previous.replace(/\n$/, "") === nextSource) return block;
    return indent + fence + language + "\n" + nextSource + "\n" + indent + fence;
  });
}
