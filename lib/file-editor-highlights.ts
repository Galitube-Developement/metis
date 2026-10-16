import type { Monaco } from "@monaco-editor/react";
type TextModel = ReturnType<Monaco["editor"]["createModel"]>;
type CodeEditor = ReturnType<Monaco["editor"]["create"]>;
import { diffLines } from "diff";
import type { FileChangeRange } from "@/lib/file-change-ranges";

export function resolveFileHighlight(model: TextModel, change: FileChangeRange) {
  const startLineNumber = Math.min(change.startLine, model.getLineCount()), endLineNumber = Math.min(change.endLine, model.getLineCount());
  const range = { startLineNumber, startColumn: 1, endLineNumber: Math.max(startLineNumber,endLineNumber), endColumn: model.getLineMaxColumn(Math.max(startLineNumber,endLineNumber)) };
  if (change.kind === "deleted") return range;
  if (change.text !== undefined) {
    const expected = change.text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n");
    if (model.getValueInRange(range).replace(/\r\n/g,"\n") === expected) return range;
    const matches = model.findMatches(expected, false, false, true, null, false, 2);
    return matches.length === 1 ? matches[0].range : null;
  }
  return range;
}

/** Minimal model edits keep undo, cursor tracking and decorations during disk synchronization. */
export function applyFileSyncContent(instance: CodeEditor, content: string) {
  const model = instance.getModel();
  if (!model || model.getValue() === content) return;
  const previous = model.getValue(), visibleContent = content.replace(/^\uFEFF/,"");
  if (model.getValue(undefined,true).startsWith("\uFEFF") !== content.startsWith("\uFEFF")) {
    const view = instance.saveViewState(); model.setValue(content); if (view) instance.restoreViewState(view); return;
  }
  const changes = diffLines(previous, visibleContent, { timeout: 50 });
  if (!changes) {
    const view = instance.saveViewState();
    instance.executeEdits("metis-file-sync",[{range:model.getFullModelRange(),text:visibleContent}]);
    if (view) instance.restoreViewState(view);
    return;
  }
  let offset = 0;
  const edits: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[] = [];
  for (let index = 0; index < changes.length;) {
    const current = changes[index];
    if (!current.added && !current.removed) { offset += current.value.length; index++; continue; }
    const from = offset; let text = "";
    while (index < changes.length && (changes[index].added || changes[index].removed)) {
      const change = changes[index++]; if (change.removed) offset += change.value.length; else text += change.value;
    }
    const start = model.getPositionAt(from), end = model.getPositionAt(offset);
    edits.push({ range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column},text });
  }
  instance.pushUndoStop(); instance.executeEdits("metis-file-sync",edits); instance.pushUndoStop();
}
