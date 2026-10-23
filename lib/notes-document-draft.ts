import type { SharedNote } from "@/lib/store";
import { equalNoteValue, type NoteConflict, type NoteDraft } from "@/lib/note-save-state";

/** Keep a possible committed value until the request outcome has been acknowledged. */
export function possibleDocumentSave(base: SharedNote, previous: NoteDraft, pending: NoteDraft): NoteDraft {
  const next = { ...previous };
  for (const field of Object.keys(pending) as Array<keyof NoteDraft>) {
    if (!equalNoteValue(pending[field], base[field])) Object.assign(next, { [field]: pending[field] });
  }
  return next;
}

/** A no-op against the old base can be an explicit undo of an unacknowledged write. */
export function uncertainDocumentConflicts(base: SharedNote, patch: NoteDraft, remote: SharedNote, possible: NoteDraft): NoteConflict[] {
  return (Object.keys(patch) as Array<keyof NoteDraft>).flatMap(field => {
    if (possible[field] === undefined || equalNoteValue(possible[field], base[field])
      || !equalNoteValue(patch[field], base[field]) || equalNoteValue(patch[field], remote[field])) return [];
    return [{ field, base: base[field], local: patch[field], remote: remote[field] }];
  });
}

/** An undo back to the saved value is still an edit while a different value is in flight. */
export function applyDocumentPatch(base: SharedNote, draft: NoteDraft, patch: NoteDraft, inFlight: NoteDraft = {}): NoteDraft {
  const next = { ...draft };
  for (const field of Object.keys(patch) as Array<keyof NoteDraft>) {
    const pendingDiffers = inFlight[field] !== undefined && !equalNoteValue(inFlight[field], patch[field]);
    if (equalNoteValue(patch[field], base[field]) && !pendingDiffers) delete next[field];
    else Object.assign(next, { [field]: patch[field] });
  }
  return next;
}
