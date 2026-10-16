import { diffArrays } from "diff";
import { diff3Merge } from "node-diff3";

export type FileSnapshot = { content: string; revision: string };
export type FileMerge = { content: string; conflict: boolean };
const tokens = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];

/** Exact line endings, no conflict markers or disk writes in the user's draft. */
export function mergeFileContents(base: string, local: string, disk: string): FileMerge {
  if (local === disk || local === base) return { content: disk, conflict: false };
  if (disk === base) return { content: local, conflict: false };
  if (base.length + local.length + disk.length > 6_000_000) return { content: local, conflict: true };
  const original = tokens(base), ours = tokens(local), theirs = tokens(disk);
  if (original.length + ours.length + theirs.length > 30_000 ||
      !diffArrays(original, ours, { timeout: 50, maxEditLength: 2000 }) ||
      !diffArrays(original, theirs, { timeout: 50, maxEditLength: 2000 })) return { content: local, conflict: true };
  const regions = diff3Merge(ours, original, theirs, { excludeFalseConflicts: true });
  if (regions.some(region => region.conflict)) return { content: local, conflict: true };
  return { content: regions.flatMap(region => region.ok || []).join(""), conflict: false };
}
