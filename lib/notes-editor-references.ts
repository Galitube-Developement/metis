import type { ReferenceResult } from "./reference-search";
/** Only a standalone @ at the caret; code and existing links are handled by the editor. */
export function notesReferenceQuery(textBefore:string) {
  const match=/(?:^|\s)@([^@\n]{0,100})$/.exec(textBefore);
  if(!match)return null;
  return {query:match[1],length:match[1].length+1};
}
export const NOTES_REFERENCE_KINDS=["note","canvas","plan"] as const;
export function notesReferenceHref(item:Pick<ReferenceResult,"kind"|"id">):string|null {
  if(!item.id || /[\u0000-\u001f]/.test(item.id))return null;
  return item.kind==="note" ? "note://"+encodeURIComponent(item.id)
    : item.kind==="canvas" || item.kind==="plan" ? "workspace://"+item.kind+"/"+encodeURIComponent(item.id) : null;
}
