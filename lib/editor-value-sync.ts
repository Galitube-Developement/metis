/**
 * Parent renders can acknowledge older local edits after newer input arrived.
 * Keep repeated values counted, rather than retaining whole documents per edit.
 * Unknown values are external replacements. An ambiguous echo is ignored so it
 * cannot roll the live editor back; a later distinct acknowledgement retires it.
 */
export function createEditorValueSync(initialValue: string) {
  let incoming = initialValue;
  let sequence = 0;
  const pending = new Map<string, { first: number; last: number; count: number }>();
  return {
    published(value: string) {
      const entry = pending.get(value);
      if (entry) { entry.last = ++sequence; entry.count++; }
      else pending.set(value, { first: ++sequence, last: sequence, count: 1 });
    },
    receive(value: string): boolean {
      if (value === incoming) return false;
      incoming = value;
      const acknowledged = pending.get(value);
      if (!acknowledged) { pending.clear(); return true; }
      // A repeated text acknowledges its earliest pending occurrence. Choosing
      // its last occurrence could mistake the next ordered echo for a remote edit.
      for (const [text, entry] of pending) {
        if (entry.last < acknowledged.first) pending.delete(text);
      }
      if (--acknowledged.count === 0) pending.delete(value);
      else if (acknowledged.count === 1) acknowledged.first = acknowledged.last;
      return false;
    },
    get pendingValueCount() { return pending.size; },
  };
}
