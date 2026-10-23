/**
 * Batch typing writes without moving the deadline on every keystroke.
 * The callback reads current refs at execution time, never a captured draft.
 */
export function createNoteDraftPersistence(write: () => void, delayMs = 200) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  function cancel() {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function flush() {
    cancel();
    write();
  }

  function schedule() {
    if (timer !== null) return;
    const scheduledGeneration = generation;
    timer = setTimeout(() => {
      if (scheduledGeneration !== generation) return;
      timer = null;
      write();
    }, delayMs);
  }

  return { schedule, flush, cancel };
}
