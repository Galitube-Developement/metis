import { type EditorNode, notesNodeSignature } from "./notes-editor-markdown";
import { NOTES_SOURCE_METADATA } from "./notes-editor-format";

export type NotesIssueReference = { id: string; key: string };
export type NotesIssueContext = { kind: "checkbox" | "selection"; sourceId: string };
export function notesSelectionSourceId(firstBlockId: string, fromOffset: number, lastBlockId: string, toOffset: number, textDigest: string) {
  return "selection:" + firstBlockId + ":" + fromOffset + "-" + lastBlockId + ":" + toOffset + ":" + textDigest;
}
export type NotesTaskLocation = { task: EditorNode; list: EditorNode; listPath: number[]; index: number };
export function findNotesTask(doc: EditorNode, sourceId: string): NotesTaskLocation | null {
  const walk = (node: EditorNode, path: number[]): NotesTaskLocation | null => {
    for (const [index, child] of (node.content || []).entries()) {
      if (node.type === "taskList" && child.type === "taskItem" && child.attrs?.blockId === sourceId) return { task: child, list: node, listPath: path, index };
      const nested = walk(child, [...path,index]); if (nested) return nested;
    }
    return null;
  };
  return walk(doc, []);
}
function freshAttrs(node: EditorNode) {
  return Object.fromEntries(Object.entries(node.attrs || {}).filter(([key]) => !NOTES_SOURCE_METADATA.has(key)));
}
/** Return a local replacement only while the exact source task is unchanged. */
export function planNotesTaskIssueConversion(doc: EditorNode, sourceId: string, expectedSignature: string, issue: NotesIssueReference): { listPath: number[]; nodes: EditorNode[] } | null {
  const found = findNotesTask(doc, sourceId);
  if (!found || notesNodeSignature(found.task) !== expectedSignature) return null;
  const { task, list, listPath, index } = found;
  const before = list.content!.slice(0,index), after = list.content!.slice(index+1);
  const firstParagraph = task.content?.[0]?.type === "paragraph" ? task.content[0] : null;
  const reference: EditorNode = {
    type:"paragraph", attrs:{blockId:sourceId}, content:[
      {type:"text",text:issue.key,marks:[{type:"link",attrs:{href:"issue://" + encodeURIComponent(issue.id)}}]},
      ...(firstParagraph?.content?.length ? [{type:"text",text:" "},...firstParagraph.content] : []),
    ],
  };
  const nodes: EditorNode[] = [];
  if (before.length) nodes.push({...list,attrs:freshAttrs(list),content:before});
  nodes.push(reference,...(task.content || []).slice(firstParagraph ? 1 : 0));
  if (after.length) nodes.push({...list,attrs:{...freshAttrs(list),...(before.length ? {blockId:null} : {})},content:after});
  const gap = list.attrs?.originalGap;
  if (typeof gap === "string") nodes[0].attrs = {...nodes[0].attrs,originalGap:gap};
  return {listPath,nodes};
}
