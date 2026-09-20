const DB_NAME = "metis-client-chat-cache";
const DB_VERSION = 1;
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
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
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

    const readTx = db.transaction(STORE_NAME, "readonly");
    const rows = await requestValue(
      readTx.objectStore(STORE_NAME).getAll() as IDBRequest<Array<CachedSnapshot<unknown>>>,
    );
    const matching = (rows || [])
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
    const readTx = db.transaction(STORE_NAME, "readonly");
    const rows = await requestValue(
      readTx.objectStore(STORE_NAME).getAll() as IDBRequest<Array<CachedSnapshot<unknown>>>,
    );
    const keys = (rows || []).filter((row) => row.scope === scope).map((row) => row.key);
    if (!keys.length) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    for (const key of keys) tx.objectStore(STORE_NAME).delete(key);
  } catch {
    // Best-effort cache cleanup.
  } finally {
    db.close();
  }
}
