import type { SharedNote } from "@/lib/store";

export type TreeNote = SharedNote & {
  parentId?: string | null;
  sortKey?: number;
  icon?: string | null;
  cover?: string | null;
  fullWidth?: boolean;
  favorite?: boolean;
};
export type NoteTreeNode = { note: TreeNote; children: NoteTreeNode[] };

/** Note titles are page labels; extensions belong to exported files only. */
export function noteDisplayTitle(title: string): string {
  return title.replace(/\.md$/i, "");
}

export function notesInContainer(notes: TreeNote[], projectId: string | null): TreeNote[] {
  return notes.filter(note => note.kind !== "learned_fact" && (note.projectId || null) === projectId);
}

export function noteDescendantIds(notes: TreeNote[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const note of notes) {
    if (!note.parentId) continue;
    const list = children.get(note.parentId) || [];
    list.push(note.id);
    children.set(note.parentId, list);
  }
  const found = new Set<string>();
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (found.has(current)) continue;
    found.add(current);
    queue.push(...children.get(current) || []);
  }
  return found;
}

export function noteAncestors(notes: TreeNote[], id: string): TreeNote[] {
  const byId = new Map(notes.map(note => [note.id, note]));
  const result: TreeNote[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    const parent: TreeNote | undefined = current.parentId ? byId.get(current.parentId) : undefined;
    if (parent && (parent.projectId || null) !== (current.projectId || null)) break;
    current = parent;
  }
  return result;
}

export function buildNoteTree(notes: TreeNote[]): NoteTreeNode[] {
  const unique = [...new Map(notes.filter(note => note.kind !== "learned_fact").map(note => [note.id, note])).values()];
  const nodes = new Map(unique.map(note => [note.id, { note, children: [] as NoteTreeNode[] }]));
  const roots: NoteTreeNode[] = [];
  for (const note of unique) {
    const node = nodes.get(note.id)!;
    const parent = note.parentId ? nodes.get(note.parentId) : undefined;
    let cyclic = false;
    const seen = new Set([note.id]);
    let walk = parent;
    while (walk) {
      if (seen.has(walk.note.id)) { cyclic = true; break; }
      seen.add(walk.note.id);
      walk = walk.note.parentId ? nodes.get(walk.note.parentId) : undefined;
    }
    if (!parent || cyclic || (parent.note.projectId || null) !== (note.projectId || null)) roots.push(node);
    else parent.children.push(node);
  }
  const sort = (items: NoteTreeNode[]) => {
    items.sort((a, b) => (a.note.sortKey ?? 0) - (b.note.sortKey ?? 0) || a.note.createdAt.localeCompare(b.note.createdAt) || a.note.id.localeCompare(b.note.id));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

export function searchNoteTree(tree: NoteTreeNode[], search: string): NoteTreeNode[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return tree;
  return tree.flatMap(node => {
    if ((node.note.title + "\n" + node.note.content).toLocaleLowerCase().includes(query)) return [node];
    const children = searchNoteTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function noteDraftStorageKey(ownerId: string, noteId: string): string {
  return "metis:notes:document:" + encodeURIComponent(ownerId) + ":" + encodeURIComponent(noteId);
}
