import { type EditorView } from "@tiptap/pm/view";

export type NotesEditorDropOptions = {
  noteId: string;
  onFiles: (files: File[]) => void | Promise<void>;
  onError: (message: string) => void;
};

/** Shared DOM drop callback. Geometry stays owned by the live ProseMirror view. */
export function createNotesEditorDropHandler({ noteId, onFiles, onError }: NotesEditorDropOptions) {
  return (view: EditorView, event: DragEvent): boolean => {
    const blockData = event.dataTransfer?.getData("application/x-metis-note-block");
    if (blockData) {
      event.preventDefault();
      try {
        const data = JSON.parse(blockData);
        if (data.noteId !== noteId || !Number.isInteger(data.pos)) return true;
        const node = view.state.doc.nodeAt(data.pos), target = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!node || !target) return true;
        const resolved = view.state.doc.resolve(target.pos);
        const destination = resolved.depth ? (event.clientY > view.coordsAtPos(resolved.before(1)).top + 16 ? resolved.after(1) : resolved.before(1)) : target.pos;
        if (destination >= data.pos && destination <= data.pos + node.nodeSize) return true;
        const tr = view.state.tr.delete(data.pos, data.pos + node.nodeSize);
        tr.insert(tr.mapping.map(destination), node); view.dispatch(tr.scrollIntoView());
      } catch { onError("Could not move that block. Use the Move up or Move down action."); }
      return true;
    }
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) { event.preventDefault(); void onFiles(files); return true; }
    return false;
  };
}
