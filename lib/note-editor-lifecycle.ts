type FlushNoteEditor = () => Promise<boolean>;
const editors = new Set<FlushNoteEditor>();
/** Keep the authentication session alive until mounted editors save their drafts. */
export function registerNoteEditorFlush(flush: FlushNoteEditor) {
  editors.add(flush);
  return () => { editors.delete(flush); };
}
export async function flushNoteEditors(): Promise<boolean> {
  const results = await Promise.allSettled([...editors].map(flush => flush()));
  return results.every(result => result.status === "fulfilled" && result.value);
}
