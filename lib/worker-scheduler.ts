export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const DEFAULT_WORKER_CONCURRENCY = 25;

/** Invalid or missing configuration falls back to a bounded production default. */
export function parseWorkerConcurrency(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_WORKER_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_CONCURRENCY;
  return Math.floor(parsed);
}

export function describeQueueWait(running: number, queuedAhead: number, maxWorkers: number): string | undefined {
  if (maxWorkers <= 0 || !Number.isFinite(maxWorkers)) return undefined;
  const workers = Math.max(1, Math.floor(maxWorkers));
  const freeSlots = Math.max(0, workers - Math.max(0, running));
  const ahead = Math.max(0, queuedAhead);
  // Only surface a wait when this job cannot take a free slot. Queued jobs
  // that still fit in remaining workers start on the next poll — no banner.
  if (ahead < freeSlots) return undefined;
  if (ahead === 0) {
    return `Max workers reached (${workers}). Waiting for a free worker slot.`;
  }
  return `Waiting for a free worker slot (${ahead} run${ahead === 1 ? "" : "s"} ahead, ${workers} parallel chats).`;
}

type Completion = { failed: false } | { failed: true; error: unknown };
type JobObserver = { completion?: Completion; listeners: Set<(completion: Completion) => void> };
// One reaction per job, rather than one permanently retained Promise.race
// reaction per poll. Timed-out poll listeners are removed immediately.
const jobObservers = new WeakMap<Promise<unknown>, JobObserver>();

function observeJob(job: Promise<unknown>): JobObserver {
  let observer = jobObservers.get(job);
  if (observer) return observer;
  observer = { listeners: new Set() };
  jobObservers.set(job, observer);
  const settled = observer;
  const finish = (completion: Completion) => {
    settled.completion = completion;
    for (const listener of settled.listeners) listener(completion);
    settled.listeners.clear();
  };
  void job.then(() => finish({ failed: false }), error => finish({ failed: true, error }));
  return observer;
}

export async function waitForSchedulerTick(
  active: ReadonlySet<Promise<unknown>>,
  concurrency: number,
  pollMs: number,
): Promise<"idle-poll" | "capacity-poll" | "slot-freed"> {
  if (active.size === 0) {
    await sleep(pollMs);
    return "idle-poll";
  }
  const atCapacity = Number.isFinite(concurrency) && concurrency > 0 && active.size >= concurrency;
  const observers = [...active].map(observeJob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCompletion!: (completion: Completion) => void;
  try {
    return await new Promise<"capacity-poll" | "slot-freed">((resolve, reject) => {
      onCompletion = completion => {
        if (completion.failed) reject(completion.error);
        else resolve("slot-freed");
      };
      for (const observer of observers) {
        if (observer.completion) onCompletion(observer.completion);
        else observer.listeners.add(onCompletion);
      }
      if (!atCapacity) timer = setTimeout(() => resolve("capacity-poll"), pollMs);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    for (const observer of observers) observer.listeners.delete(onCompletion);
  }
}
