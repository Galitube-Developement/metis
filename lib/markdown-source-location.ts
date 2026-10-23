import type { WorkspaceFileLocation } from "@/lib/workspace-file-link";

export type MarkdownSourceRange = { from: number; to: number; kind: "added" | "deleted" };

/** Resolve source links against the current document; stale snippets only relocate when unique. */
export function resolveMarkdownSourceLocation(value: string, location: WorkspaceFileLocation): {
  from: number;
  to: number;
  changes: MarkdownSourceRange[];
} {
  const lines = value.split("\n");
  const starts = [0];
  for (let index = 0; index < lines.length - 1; index++) starts.push(starts[index] + lines[index].length + 1);
  const lineIndex = (line: number | undefined) => Math.max(0, Math.min(lines.length - 1, Math.floor(Number.isFinite(line) ? line! : 1) - 1));
  const lineLength = (index: number) => lines[index].replace(/\r$/, "").length;
  const position = (line: number | undefined, column = 1) => {
    const index = lineIndex(line);
    return starts[index] + Math.max(0, Math.min(lineLength(index), Math.floor(Number.isFinite(column) ? column : 1) - 1));
  };
  const selectedLine = lineIndex(location.line);
  let from = position(location.line, location.column);
  let to = location.endLine
    ? position(Math.max(selectedLine + 1, location.endLine), location.endColumn ?? lineLength(lineIndex(location.endLine)) + 1)
    : from;
  to = Math.max(from, to);

  const normalized = value.replace(/\r\n/g, "\n");
  const removedCarriages: number[] = [];
  for (let index = 0, count = 0; index < value.length - 1; index++) {
    if (value[index] === "\r" && value[index + 1] === "\n") removedCarriages.push(index - count++);
  }
  const originalOffset = (normalizedOffset: number) => {
    let low = 0, high = removedCarriages.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (removedCarriages[middle] < normalizedOffset) low = middle + 1;
      else high = middle;
    }
    return normalizedOffset + low;
  };
  const changes: MarkdownSourceRange[] = [];
  for (const change of location.changes || []) {
    const start = lineIndex(change.startLine), end = Math.max(start, lineIndex(change.endLine));
    let changeFrom = starts[start], changeTo = starts[end] + lineLength(end);
    if (change.kind !== "deleted" && change.text !== undefined) {
      const expected = change.text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
      if (value.slice(changeFrom, changeTo).replace(/\r\n/g, "\n") !== expected) {
        if (!expected) continue;
        const match = normalized.indexOf(expected);
        if (match < 0 || normalized.indexOf(expected, match + 1) !== -1) continue;
        changeFrom = originalOffset(match);
        changeTo = originalOffset(match + expected.length);
      }
    }
    changes.push({ from: changeFrom, to: changeTo, kind: change.kind });
  }
  if (changes.length) ({ from, to } = changes[0]);
  return { from, to, changes };
}
