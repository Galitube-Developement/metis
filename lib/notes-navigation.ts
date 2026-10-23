/** URL fragments remain navigable when the browser keeps the Notes workspace mounted. */
export type NotesNavigationTarget =
  | {kind:"note";id:string;blockId?:string}
  | {kind:"issue";id:string};

export function notesNavigationTarget(hash:string,focusNoteId?:string|null):NotesNavigationTarget|null {
  const note=/^#note-([^/?#]+)(?:\/block-([A-Za-z0-9_-]+))?$/.exec(hash);
  const issue=/^#issue-([^/?#]+)$/.exec(hash);
  let noteId:string|null=null;
  try {noteId=note?decodeURIComponent(note[1]):null;} catch { /* Keep an explicit valid focus usable despite a malformed fragment. */ }
  if(focusNoteId) return {kind:"note",id:focusNoteId,...(noteId===focusNoteId&&note?.[2]?{blockId:note[2]}:{})};
  try {
    if(issue) return {kind:"issue",id:decodeURIComponent(issue[1])};
    if(noteId) return {kind:"note",id:noteId,...(note?.[2]?{blockId:note[2]}:{})};
  } catch { /* A malformed pasted fragment cannot crash the Notes workspace. */ }
  return null;
}

type NotesLocationSource = {
  location:{hash:string};
  addEventListener:(type:string,listener:EventListener)=>void;
  removeEventListener:(type:string,listener:EventListener)=>void;
};
export function subscribeNotesHashNavigation(source:NotesLocationSource,onNavigate:(target:NotesNavigationTarget)=>void) {
  const navigate=()=>{
    const target=notesNavigationTarget(source.location.hash);
    if(target)onNavigate(target);
  };
  source.addEventListener("hashchange",navigate);
  source.addEventListener("popstate",navigate);
  return ()=>{
    source.removeEventListener("hashchange",navigate);
    source.removeEventListener("popstate",navigate);
  };
}
