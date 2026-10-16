import { diffLines } from "diff";

export type FileChangeRange = { startLine: number; endLine: number; kind: "added" | "deleted"; oldStartLine?: number; oldEndLine?: number; text?: string };
export type FileLineChange = { oldStart: number; oldCount: number; newStart: number; newCount: number };
export type FileChangeDetails = { additions: number; deletions: number; ranges: FileChangeRange[]; lineChanges: FileLineChange[] };

export function fileChangeDetails(before: string, after: string): FileChangeDetails | undefined {
  if (before.length + after.length > 2_000_000) return undefined;
  const diff = diffLines(before, after, { timeout: 50 });
  if (!diff) return undefined;
  let oldLine = 1, newLine = 1, textBudget = 16_000;
  const result: FileChangeDetails = { additions: 0, deletions: 0, ranges: [], lineChanges: [] };
  for (let index = 0; index < diff.length;) {
    const part = diff[index];
    if (!part.added && !part.removed) { oldLine += part.count; newLine += part.count; index++; continue; }
    const oldStart = oldLine, newStart = newLine;
    let oldCount = 0, newCount = 0, addedText = "";
    while (index < diff.length && (diff[index].added || diff[index].removed)) {
      const change = diff[index++];
      if (change.removed) { oldCount += change.count; oldLine += change.count; }
      else { newCount += change.count; newLine += change.count; addedText += change.value; }
    }
    result.additions += newCount; result.deletions += oldCount;
    if (result.lineChanges.length >= 100) continue;
    result.lineChanges.push({ oldStart, oldCount, newStart, newCount });
    if (newCount) {
      const snippet = addedText.replace(/\r?\n$/, "");
      const keepText = snippet.length <= 4000 && snippet.length <= textBudget;
      if (keepText) textBudget -= snippet.length;
      result.ranges.push({ startLine: newStart, endLine: newStart + newCount - 1, kind: "added", ...(keepText ? { text: snippet } : {}) });
    } else {
      result.ranges.push({ startLine: newStart, endLine: newStart, kind: "deleted", oldStartLine: oldStart, oldEndLine: oldStart + oldCount - 1 });
    }
  }
  return result;
}

/** Shift untouched earlier ranges through subsequent edits; replacements supersede overlaps. */
export function rebaseFileChangeRanges(ranges: FileChangeRange[], changes: FileLineChange[]): FileChangeRange[] {
  // A capped mapping may omit later changes; do not carry stale coordinates forward.
  if (changes.length >= 100) return [];
  return ranges.flatMap(range => {
    let shift = 0;
    for (const change of changes) {
      if (change.oldCount && change.oldStart <= range.endLine && change.oldStart + change.oldCount > range.startLine) return [];
      if (!change.oldCount && change.oldStart > range.startLine && change.oldStart <= range.endLine) return [];
      if (change.oldStart + change.oldCount <= range.startLine) shift += change.newCount - change.oldCount;
    }
    return [{ ...range, startLine: range.startLine + shift, endLine: range.endLine + shift }];
  });
}

export function parseFileChangeRanges(value: unknown): FileChangeRange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0,100).flatMap(item => {
    if (!item || typeof item !== "object" || !Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) ||
        item.startLine < 1 || item.endLine < item.startLine || !["added","deleted"].includes(item.kind)) return [];
    return [{ startLine: item.startLine, endLine: item.endLine, kind: item.kind as FileChangeRange["kind"],
      ...(typeof item.text === "string" && item.text.length <= 4000 ? { text: item.text } : {}),
      ...(Number.isSafeInteger(item.oldStartLine) && item.oldStartLine > 0 ? { oldStartLine: item.oldStartLine } : {}),
      ...(Number.isSafeInteger(item.oldEndLine) && item.oldEndLine >= item.oldStartLine ? { oldEndLine: item.oldEndLine } : {}) }];
  });
}
