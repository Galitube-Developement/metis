const DB_NAME = "metis-client-chat-cache";
// Invalidate pre-lazy-payload snapshots once; they retained megabytes of raw
// tool input/output even when the server returned a compact replacement.
const DB_VERSION = 2;
const STORE_NAME = "snapshots";
export const MAX_SNAPSHOTS = 8;
export const MAX_MEMORY_CHAT_SNAPSHOTS = 8;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneMemoryChatCache<K, V>(cache: Map<K, V>, keep: Iterable<K>, max = MAX_MEMORY_CHAT_SNAPSHOTS) {
  const keepSet = new Set(Array.from(keep));
  for (const key of [...cache.keys()]) {
    if (cache.size <= max) return cache;
    if (!keepSet.has(key)) cache.delete(key);
  }
  const protectedKey = Array.from(keepSet)[0];
  for (const key of [...cache.keys()]) {
    if (cache.size <= max) break;
    if (key === protectedKey) continue;
    cache.delete(key);
  }
  return cache;
}

export function shouldPersistClientChatSnapshot(options: { busy: boolean; incognito?: boolean }) {
  return !options.busy && !options.incognito;
}

export const MAX_MEMORY_CHAT_CACHE_BYTES = 16 * 1024 * 1024;

// Reject oversized cache copies; the server remains the source of chat history.
export function estimateChatSnapshotBytes(value: unknown, limit = MAX_MEMORY_CHAT_CACHE_BYTES): number {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  let bytes = 0;
  let visited = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++visited > 50_000) return limit + 1;
    if (typeof item === "string") bytes += item.length * 2;
    else if (item && typeof item === "object" && !seen.has(item)) {
      seen.add(item);
      bytes += 64;
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        bytes += key.length * 2 + 8;
        if (bytes > limit || pending.length >= 50_000) return limit + 1;
        pending.push((item as Record<string, unknown>)[key]);
      }
    } else bytes += 8;
    if (bytes > limit) return limit + 1;
  }
  return bytes;
}

/** Enforce count and byte budgets on every write, including prefetch/background updates. */
export class BoundedChatSnapshotCache<K, V> extends Map<K, V> {
  private readonly sizes = new Map<K, number>();
  constructor(
    private readonly protectedKeys: () => Iterable<K> = () => [],
    private readonly maxEntries = MAX_MEMORY_CHAT_SNAPSHOTS,
    private readonly maxBytes = MAX_MEMORY_CHAT_CACHE_BYTES,
  ) { super(); }

  override set(key: K, value: V): this {
    const size = estimateChatSnapshotBytes(value, this.maxBytes);
    this.delete(key);
    if (size > this.maxBytes) return this;
    super.set(key, value);
    this.sizes.set(key, size);
    const keep = new Set(this.protectedKeys());
    const overBudget = () => this.size > this.maxEntries || [...this.sizes.values()].reduce((sum, bytes) => sum + bytes, 0) > this.maxBytes;
    for (const candidate of this.keys()) {
      if (!overBudget()) break;
      if (!keep.has(candidate)) this.delete(candidate);
    }
    // A protected snapshot may itself consume the budget. Never grow without bound.
    for (const candidate of this.keys()) {
      if (!overBudget()) break;
      this.delete(candidate);
    }
    return this;
  }
  override delete(key: K): boolean { this.sizes.delete(key); return super.delete(key); }
  override clear(): void { this.sizes.clear(); super.clear(); }
}

type CachedSnapshot<T> = {
  key: string;
  scope: string;
  chatId: string;
  cachedAt: number;
  value: T;
};

function available() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function cacheKey(scope: string, chatId: string) {
  return `${scope.trim() || "default"}::${chatId}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      const finish = (db: IDBDatabase | null) => {
        if (settled) { db?.close(); return; }
        settled = true;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        } else if ((event as IDBVersionChangeEvent).oldVersion < DB_VERSION) {
          request.transaction?.objectStore(STORE_NAME).clear();
        }
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      resolve(null);
    }
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

type SnapshotMetadata = Pick<CachedSnapshot<unknown>, "key" | "scope" | "cachedAt">;

// Never clone all transcripts at once just to prune their keys.
function readSnapshotMetadata(db: IDBDatabase): Promise<SnapshotMetadata[]> {
  return new Promise((resolve) => {
    const rows: SnapshotMetadata[] = [];
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(rows); return; }
      const row = cursor.value as CachedSnapshot<unknown>;
      rows.push({ key: row.key, scope: row.scope, cachedAt: row.cachedAt });
      cursor.continue();
    };
  });
}

export async function readClientChatSnapshot<T>(scope: string, chatId: string): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const row = await requestValue(
      tx.objectStore(STORE_NAME).get(cacheKey(scope, chatId)) as IDBRequest<CachedSnapshot<T> | undefined>,
    );
    if (!row) return null;
    if (Date.now() - row.cachedAt > MAX_AGE_MS) {
      void deleteClientChatSnapshot(scope, chatId);
      return null;
    }
    return row.value;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function writeClientChatSnapshot<T>(scope: string, chatId: string, value: T): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    if (estimateChatSnapshotBytes(value) > MAX_MEMORY_CHAT_CACHE_BYTES) {
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(cacheKey(scope, chatId));
      return;
    }
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      key: cacheKey(scope, chatId),
      scope: scope.trim() || "default",
      chatId,
      cachedAt: Date.now(),
      value,
    } satisfies CachedSnapshot<T>);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });

    const countTx = db.transaction(STORE_NAME, "readonly");
    const count = await requestValue(countTx.objectStore(STORE_NAME).count() as IDBRequest<number>);
    if ((count || 0) <= MAX_SNAPSHOTS) return;

    const rows = await readSnapshotMetadata(db);
    const matching = rows
      .filter((row) => row.scope === (scope.trim() || "default"))
      .sort((a, b) => b.cachedAt - a.cachedAt);
    const stale = matching.slice(MAX_SNAPSHOTS);
    if (stale.length) {
      const pruneTx = db.transaction(STORE_NAME, "readwrite");
      for (const row of stale) pruneTx.objectStore(STORE_NAME).delete(row.key);
    }
  } catch {
    // Cache failures must never block chat navigation.
  } finally {
    db.close();
  }
}

export async function deleteClientChatSnapshot(scope: string, chatId: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(cacheKey(scope, chatId));
  } catch {
    // Best-effort cache cleanup.
  } finally {
    db.close();
  }
}

export async function clearClientChatSnapshots(scope?: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    if (!scope) {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      return;
    }
    const rows = await readSnapshotMetadata(db);
    const keys = rows.filter((row) => row.scope === scope).map((row) => row.key);
    if (!keys.length) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    for (const key of keys) tx.objectStore(STORE_NAME).delete(key);
  } catch {
    // Best-effort cache cleanup.
  } finally {
    db.close();
  }
}
