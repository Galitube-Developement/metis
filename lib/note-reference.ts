import { noteDisplayTitle } from "@/lib/notes-tree";

/** Portable links returned with saved notes; never persist these display fields. */
export function noteLinkFields(note: { id: string; title: string }) {
  const noteLink = "note://" + encodeURIComponent(note.id);
  const title = noteDisplayTitle(note.title).replace(/[\r\n\t]+/g, " ").trim() || "Untitled note";
  // Entities keep literal titles safe from Markdown and math preprocessing alike.
  const label = title.replace(/[&<>\[\]\\*_~\x60$]/g, character => "&#" + character.charCodeAt(0) + ";");
  return { noteLink, markdown: "[" + label + "](" + noteLink + ")" };
}
