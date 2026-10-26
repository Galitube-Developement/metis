import assert from "node:assert/strict";
import test from "node:test";
import {
  APPEARANCE_LEGACY_OWNER_KEY,
  createAppearanceAccountClient,
  type AppearanceAccountRecord,
  type AppearanceAccountSnapshot,
  type AppearanceStorageLike,
} from "../lib/appearance-account-client";
import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  MAX_APPEARANCE_STATE_BYTES,
  createDefaultAppearanceState,
  type AppearanceState,
} from "../lib/appearance-storage";
import { type ThemeDefinition } from "../lib/appearance-theme";

function theme(name = "Custom", color = "#123456"): ThemeDefinition {
  return { format: "metis-theme", version: 1, name, mode: "dark", variables: { "--primary": color } };
}
function state(selected = "midnight"): AppearanceState {
  return { ...createDefaultAppearanceState(), selected };
}
function record(ownerId = "owner-a", appearance: AppearanceState | null = state(), revision = 1): AppearanceAccountRecord {
  return { ownerId, state: appearance, revision };
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function fetcher(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => handler(input, init)) as typeof fetch;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function settled() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
class MemoryStorage implements AppearanceStorageLike {
  values = new Map<string, string>();
  denyReads = false;
  denyWrites = false;
  getItem(key: string) {
    if (this.denyReads) throw new Error("Storage denied");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.denyWrites) throw new Error("Storage denied");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.denyWrites) throw new Error("Storage denied");
    this.values.delete(key);
  }
}
function legacyStorage(appearance: AppearanceState) {
  const storage = new MemoryStorage();
  storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  return storage;
}
function selected(snapshot: AppearanceAccountSnapshot) {
  return snapshot.record?.state?.selected;
}

test("initial server state is immediately available and signed-out differs from not loaded", () => {
  const initial = record("owner-a", state("sand"), 8);
  const client = createAppearanceAccountClient({ initialRecord: initial });
  assert.deepEqual(client.getSnapshot(), { record: initial, ready: true, busy: false, error: "" });
  assert.notEqual(client.getSnapshot().record?.state, initial.state);
  assert.equal(createAppearanceAccountClient().getSnapshot().ready, false);
  assert.equal(createAppearanceAccountClient({ initialRecord: null }).getSnapshot().ready, true);
});

test("PATCH confirms before applying, sends owner/revision, and blocks parallel writes", async () => {
  const pending = deferred<Response>();
  const requests: RequestInit[] = [];
  const client = createAppearanceAccountClient({
    initialRecord: record(),
    fetcher: fetcher((_url, init) => { requests.push(init!); return pending.promise; }),
  });
  const save = client.mutate((current) => ({ ...current, selected: "paper" }));
  await settled();
  assert.equal(client.getSnapshot().busy, true);
  assert.equal(selected(client.getSnapshot()), "midnight");
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(String(requests[0].body)), {
    ownerId: "owner-a", revision: 1, state: state("paper"),
  });
  await assert.rejects(client.mutate((current) => current), /already being saved/);
  assert.equal(requests.length, 1);
  pending.resolve(response(record("owner-a", state("paper"), 2)));
  assert.equal((await save).revision, 2);
  assert.equal(selected(client.getSnapshot()), "paper");
  assert.equal(client.getSnapshot().busy, false);
});

test("mutating a callback argument cannot optimistically mutate the confirmed record", async () => {
  const pending = deferred<Response>();
  const client = createAppearanceAccountClient({
    initialRecord: record(),
    fetcher: fetcher(() => pending.promise),
  });
  const save = client.mutate((current) => { current.selected = "forest"; return current; });
  await settled();
  assert.equal(selected(client.getSnapshot()), "midnight");
  pending.resolve(response(record("owner-a", state("forest"), 2)));
  await save;
  assert.equal(selected(client.getSnapshot()), "forest");
});

test("a mutation invalidates an older GET even when fetch ignores AbortSignal", async () => {
  const oldGet = deferred<Response>();
  let getSignal: AbortSignal | null | undefined;
  const client = createAppearanceAccountClient({
    initialRecord: record(),
    fetcher: fetcher((_url, init) => {
      if (init?.method === "GET") { getSignal = init.signal; return oldGet.promise; }
      return response(record("owner-a", state("paper"), 2));
    }),
  });
  const refresh = client.refresh();
  await client.mutate((current) => ({ ...current, selected: "paper" }));
  assert.equal(getSignal?.aborted, true);
  oldGet.resolve(response(record("owner-a", state("graphite"), 1)));
  await refresh;
  assert.equal(selected(client.getSnapshot()), "paper");
  assert.equal(client.getSnapshot().record?.revision, 2);
});

test("reset prevents an old account's deferred GET from replacing the new account", async () => {
  const oldGet = deferred<Response>();
  let gets = 0;
  const changes: AppearanceAccountSnapshot[] = [];
  const client = createAppearanceAccountClient({
    initialRecord: record(),
    onChange: (snapshot) => changes.push(snapshot),
    fetcher: fetcher(() => ++gets === 1 ? oldGet.promise : response(record("owner-b", state("sand"), 4))),
  });
  const first = client.refresh();
  client.reset();
  assert.deepEqual(client.getSnapshot(), { record: null, ready: false, busy: false, error: "" });
  await client.refresh();
  oldGet.resolve(response(record("owner-a", state("forest"), 2)));
  await first;
  assert.equal(client.getSnapshot().record?.ownerId, "owner-b");
  assert.equal(selected(client.getSnapshot()), "sand");
  assert.equal(changes.at(-1)?.record?.ownerId, "owner-b");
});

test("reset aborts a pending PATCH and its late response cannot apply to another account", async () => {
  const oldPatch = deferred<Response>();
  let patchSignal: AbortSignal | null | undefined;
  const client = createAppearanceAccountClient({
    initialRecord: record(),
    fetcher: fetcher((_url, init) => {
      if (init?.method === "PATCH") { patchSignal = init.signal; return oldPatch.promise; }
      return response(record("owner-b", state("sand"), 1));
    }),
  });
  const save = client.mutate((current) => ({ ...current, selected: "forest" }));
  await settled();
  client.reset();
  assert.equal(patchSignal?.aborted, true);
  await client.refresh();
  oldPatch.resolve(response(record("owner-a", state("forest"), 2)));
  await assert.rejects(save, /cancelled/);
  assert.equal(client.getSnapshot().record?.ownerId, "owner-b");
  assert.equal(selected(client.getSnapshot()), "sand");
});

test("dispose suppresses all later notifications and responses", async () => {
  const pending = deferred<Response>();
  let changes = 0;
  const client = createAppearanceAccountClient({
    fetcher: fetcher(() => pending.promise), onChange: () => changes++,
  });
  const refresh = client.refresh();
  client.dispose();
  const count = changes;
  pending.resolve(response(record()));
  await refresh;
  assert.equal(changes, count);
  assert.equal(client.getSnapshot().record, null);
  await assert.rejects(client.mutate((current) => current), /cancelled/);
});

test("write errors retain the theme and never expose private server/network errors", async () => {
  for (const fail of [
    fetcher(() => response({ error: "SECRET_SERVER_ERROR" }, 500)),
    fetcher(() => { throw new Error("SECRET_NETWORK_ERROR"); }),
  ]) {
    const client = createAppearanceAccountClient({ initialRecord: record(), fetcher: fail });
    await assert.rejects(client.mutate((current) => ({ ...current, selected: "paper" })), /could not be saved/);
    assert.equal(selected(client.getSnapshot()), "midnight");
    assert.equal(client.getSnapshot().busy, false);
    assert.doesNotMatch(client.getSnapshot().error, /SECRET/);
  }
});

test("409 applies the latest matching server record and rejects so the editor can keep its draft", async () => {
  const latest = record("owner-a", state("nord"), 6);
  const client = createAppearanceAccountClient({
    initialRecord: record(),
    fetcher: fetcher(() => response({ ...latest, error: "PRIVATE_CONFLICT_DETAIL" }, 409)),
  });
  await assert.rejects(client.mutate((current) => ({ ...current, selected: "paper" })), /changed on another device/);
  assert.deepEqual(client.getSnapshot().record, latest);
  assert.doesNotMatch(client.getSnapshot().error, /PRIVATE/);
  assert.equal(client.getSnapshot().busy, false);
});

test("a PATCH response owned by another account is never applied", async () => {
  for (const status of [200, 409]) {
    const client = createAppearanceAccountClient({
      initialRecord: record(),
      fetcher: fetcher(() => response(record("owner-b", state("sand"), 3), status)),
    });
    await assert.rejects(client.mutate((current) => current), /account changed/);
    assert.equal(client.getSnapshot().record, null);
    assert.equal(client.getSnapshot().busy, false);
  }
});

test("401 clears account settings for reads and writes", async () => {
  const read = createAppearanceAccountClient({
    initialRecord: record(), fetcher: fetcher(() => response({}, 401)),
  });
  await read.refresh();
  assert.deepEqual(read.getSnapshot(), { record: null, ready: true, busy: false, error: "" });
  const write = createAppearanceAccountClient({
    initialRecord: record(), fetcher: fetcher(() => response({}, 401)),
  });
  await assert.rejects(write.mutate((current) => current), /Sign in again/);
  assert.equal(write.getSnapshot().record, null);
  assert.equal(write.getSnapshot().ready, true);
});

test("failed refreshes settle ready and preserve confirmed settings", async () => {
  for (const fail of [
    fetcher(() => { throw new Error("PRIVATE_NETWORK_ERROR"); }),
    fetcher(() => response({ ownerId: "owner-a", revision: 3, state: { version: 9 } })),
    fetcher(() => response({ error: "PRIVATE_SERVER_ERROR" }, 503)),
  ]) {
    const client = createAppearanceAccountClient({ initialRecord: record(), fetcher: fail });
    await client.refresh();
    assert.equal(client.getSnapshot().ready, true);
    assert.equal(selected(client.getSnapshot()), "midnight");
    assert.ok(client.getSnapshot().error);
    assert.doesNotMatch(client.getSnapshot().error, /PRIVATE/);
  }
  const firstLoad = createAppearanceAccountClient({ fetcher: fetcher(() => response({}, 503)) });
  await firstLoad.refresh();
  assert.equal(firstLoad.getSnapshot().ready, true);
  assert.equal(firstLoad.getSnapshot().record, null);
});

test("response limits are enforced for declared and streaming bodies before JSON parsing", async () => {
  let cancelled = false;
  const streaming = new ReadableStream<Uint8Array>({
    start(stream) { stream.enqueue(new Uint8Array(MAX_APPEARANCE_STATE_BYTES + 16 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  const bodies = [
    new Response("{}", { headers: { "content-length": String(MAX_APPEARANCE_STATE_BYTES * 2) } }),
    new Response(streaming),
  ];
  for (const body of bodies) {
    const client = createAppearanceAccountClient({ initialRecord: record(), fetcher: fetcher(() => body) });
    await client.refresh();
    assert.match(client.getSnapshot().error, /invalid appearance settings/);
    assert.equal(selected(client.getSnapshot()), "midnight");
  }
  assert.equal(cancelled, true);
});

test("legacy selection/custom themes migrate once after confirmation and are never inherited by another account", async () => {
  const local = state("custom-local");
  local.customThemes.push({ id: "custom-local", theme: theme("Local") });
  const storage = legacyStorage(local);
  storage.setItem(LEGACY_APPEARANCE_STORAGE_KEY, "graphite");
  const pending = deferred<Response>();
  let patch: Record<string, unknown> | undefined;
  const client = createAppearanceAccountClient({
    storage,
    fetcher: fetcher((_url, init) => {
      if (init?.method === "GET") return response(record("owner-a", null, 0));
      patch = JSON.parse(String(init?.body));
      return pending.promise;
    }),
  });
  const refresh = client.refresh();
  await settled();
  assert.equal(client.getSnapshot().busy, true);
  assert.equal(client.getSnapshot().record?.state, null);
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), null);
  assert.notEqual(storage.getItem(APPEARANCE_STORAGE_KEY), null);
  assert.deepEqual(patch, { ownerId: "owner-a", revision: 0, state: local });
  pending.resolve(response(record("owner-a", local, 1)));
  await refresh;
  assert.equal(selected(client.getSnapshot()), "custom-local");
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), "owner-a");
  assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_APPEARANCE_STORAGE_KEY), null);
  storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(local));
  let writes = 0;
  const other = createAppearanceAccountClient({
    storage, fetcher: fetcher((_url, init) => {
      if (init?.method === "PATCH") writes++;
      return response(record("owner-b", null, 0));
    }),
  });
  await other.refresh();
  assert.equal(writes, 0);
  assert.equal(other.getSnapshot().record?.state, null);
});

test("migration preserves server selection, deduplicates content, and remaps ID collisions stably", async () => {
  async function migrate() {
    const server = state("paper");
    server.customThemes.push(
      { id: "custom-collision", theme: theme("Server", "#111111") },
      { id: "custom-existing", theme: theme("Shared", "#333333") },
    );
    const local = state("custom-collision");
    local.customThemes.push(
      { id: "custom-collision", theme: theme("Local", "#222222") },
      { id: "custom-duplicate", theme: theme("Shared", "#333333") },
    );
    const storage = legacyStorage(local);
    let saved: AppearanceState | undefined;
    const client = createAppearanceAccountClient({
      storage,
      fetcher: fetcher((_url, init) => {
        if (init?.method === "GET") return response(record("owner-a", server, 4));
        saved = JSON.parse(String(init?.body)).state;
        return response(record("owner-a", saved!, 5));
      }),
    });
    await client.refresh();
    assert.equal(saved?.selected, "paper");
    assert.equal(saved?.customThemes.length, 3);
    assert.equal(saved?.customThemes.find((item) => item.id === "custom-collision")?.theme.name, "Server");
    assert.equal(saved?.customThemes.filter((item) => item.theme.name === "Shared").length, 1);
    const imported = saved!.customThemes.find((item) => item.theme.name === "Local")!;
    assert.match(imported.id, /^custom-migrated-/);
    return imported.id;
  }
  assert.equal(await migrate(), await migrate());
});

test("a null account inherits the remapped selection when local themes have duplicate content", async () => {
  const local = state("custom-second");
  local.customThemes.push(
    { id: "custom-first", theme: theme("Shared") },
    { id: "custom-second", theme: theme("Shared") },
  );
  const client = createAppearanceAccountClient({
    storage: legacyStorage(local),
    fetcher: fetcher((_url, init) => init?.method === "GET" ? response(record("owner-a", null, 0))
      : response(record("owner-a", JSON.parse(String(init?.body)).state, 1))),
  });
  await client.refresh();
  assert.equal(selected(client.getSnapshot()), "custom-first");
  assert.equal(client.getSnapshot().record?.state?.customThemes.length, 1);
});

test("a first user mutation combines pending migration and the edit into one confirmed write", async () => {
  const local = state("graphite");
  local.customThemes.push({ id: "custom-local", theme: theme("Local") });
  const storage = legacyStorage(local);
  const requests: RequestInit[] = [];
  const client = createAppearanceAccountClient({
    initialRecord: record("owner-a", null, 0),
    storage,
    fetcher: fetcher((_url, init) => {
      requests.push(init!);
      return response(record("owner-a", JSON.parse(String(init?.body)).state, 1));
    }),
  });
  let transforms = 0;
  await client.mutate((current) => { transforms++; return { ...current, selected: "paper" }; });
  assert.equal(transforms, 1);
  assert.equal(requests.length, 1);
  assert.equal(selected(client.getSnapshot()), "paper");
  assert.equal(client.getSnapshot().record?.state?.customThemes[0].id, "custom-local");
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), "owner-a");
});

test("migration limits leave legacy untouched and normal account edits can free capacity", async () => {
  const server = state();
  server.customThemes = Array.from({ length: 20 }, (_, index) => ({
    id: "custom-server-" + index, theme: theme("Server " + index),
  }));
  const local = state("graphite");
  local.customThemes.push({ id: "custom-local", theme: theme("Local") });
  const storage = legacyStorage(local);
  let current = record("owner-a", server, 1);
  let patches = 0;
  const client = createAppearanceAccountClient({
    storage, fetcher: fetcher((_url, init) => {
      if (init?.method === "PATCH") {
        patches++;
        current = record("owner-a", JSON.parse(String(init.body)).state, current.revision + 1);
      }
      return response(current);
    }),
  });
  await client.refresh();
  assert.equal(patches, 0);
  assert.match(client.getSnapshot().error, /browser could not be imported/);
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), null);
  await client.mutate((appearance) => ({ ...appearance, customThemes: appearance.customThemes.slice(0, 19) }));
  assert.equal(patches, 1);
  assert.equal(client.getSnapshot().record?.state?.customThemes.length, 19);
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), null);
  assert.notEqual(storage.getItem(APPEARANCE_STORAGE_KEY), null);
  await client.refresh();
  assert.equal(patches, 2);
  assert.equal(client.getSnapshot().record?.state?.customThemes.length, 20);
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), "owner-a");
});

test("corrupt/oversized legacy is retained as a warning without blocking account writes", async () => {
  for (const value of ["{broken", " ".repeat(MAX_APPEARANCE_STATE_BYTES + 1)]) {
    const storage = new MemoryStorage();
    storage.setItem(APPEARANCE_STORAGE_KEY, value);
    let current = record();
    const client = createAppearanceAccountClient({
      storage, fetcher: fetcher((_url, init) => {
        if (init?.method === "PATCH") current = record("owner-a", JSON.parse(String(init.body)).state, 2);
        return response(current);
      }),
    });
    await client.refresh();
    assert.match(client.getSnapshot().error, /browser could not be imported/);
    await client.mutate((appearance) => ({ ...appearance, selected: "paper" }));
    assert.equal(selected(client.getSnapshot()), "paper");
    assert.match(client.getSnapshot().error, /browser could not be imported/);
    assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), null);
    assert.equal(storage.getItem(APPEARANCE_STORAGE_KEY), value);
  }
});

test("failed/conflicting migration does not claim or remove legacy data", async () => {
  for (const status of [500, 409]) {
    const storage = legacyStorage(state("graphite"));
    const latest = record("owner-a", state("sand"), 3);
    const client = createAppearanceAccountClient({
      storage,
      fetcher: fetcher((_url, init) => init?.method === "GET" ? response(record())
        : response(status === 409 ? latest : { error: "PRIVATE" }, status)),
    });
    await client.refresh();
    assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), null);
    assert.notEqual(storage.getItem(APPEARANCE_STORAGE_KEY), null);
    assert.equal(client.getSnapshot().busy, false);
    if (status === 409) assert.equal(selected(client.getSnapshot()), "sand");
  }
});

test("denied storage cannot block account writes, including failed post-save migration bookkeeping", async () => {
  const denied = new MemoryStorage();
  denied.denyReads = true;
  denied.denyWrites = true;
  const client = createAppearanceAccountClient({
    initialRecord: record(), storage: denied,
    fetcher: fetcher((_url, init) => response(record("owner-a", JSON.parse(String(init?.body)).state, 2))),
  });
  await client.mutate((current) => ({ ...current, selected: "paper" }));
  assert.equal(selected(client.getSnapshot()), "paper");
  assert.equal(client.getSnapshot().error, "");

  const bookkeeping = legacyStorage(state("graphite"));
  bookkeeping.denyWrites = true;
  const migrate = createAppearanceAccountClient({
    initialRecord: record("owner-a", null, 0), storage: bookkeeping,
    fetcher: fetcher((_url, init) => response(record("owner-a", JSON.parse(String(init?.body)).state, 1))),
  });
  await migrate.mutate((current) => current);
  assert.equal(selected(migrate.getSnapshot()), "graphite");
  assert.equal(migrate.getSnapshot().error, "");
  let writes = 0;
  const other = createAppearanceAccountClient({
    storage: bookkeeping, fetcher: fetcher((_url, init) => {
      if (init?.method === "PATCH") writes++;
      return response(record("owner-b", null, 0));
    }),
  });
  await other.refresh();
  assert.equal(writes, 0);
});

test("a shared migration lock prevents two accounts from importing the same browser legacy", async () => {
  let queue = Promise.resolve();
  const lock = <T>(action: () => Promise<T>): Promise<T> => {
    const run = queue.then(action);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  const storage = legacyStorage(state("graphite"));
  const firstPatch = deferred<Response>();
  const writes: string[] = [];
  const one = createAppearanceAccountClient({
    storage, withMigrationLock: lock,
    fetcher: fetcher((_url, init) => {
      if (init?.method === "GET") return response(record("owner-a", null, 0));
      writes.push("owner-a");
      return firstPatch.promise;
    }),
  });
  const two = createAppearanceAccountClient({
    storage, withMigrationLock: lock,
    fetcher: fetcher((_url, init) => {
      if (init?.method === "GET") return response(record("owner-b", null, 0));
      writes.push("owner-b");
      return response(record("owner-b", state("graphite"), 1));
    }),
  });
  const first = one.refresh();
  await settled();
  const second = two.refresh();
  await settled();
  assert.deepEqual(writes, ["owner-a"]);
  firstPatch.resolve(response(record("owner-a", state("graphite"), 1)));
  await Promise.all([first, second]);
  assert.deepEqual(writes, ["owner-a"]);
  assert.equal(selected(one.getSnapshot()), "graphite");
  assert.equal(two.getSnapshot().record?.state, null);
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), "owner-a");
});

test("a reset while waiting for the migration lock prevents the stale owner's write", async () => {
  const unlock = deferred<void>();
  const storage = legacyStorage(state("graphite"));
  let writes = 0;
  const client = createAppearanceAccountClient({
    storage,
    withMigrationLock: async (action) => { await unlock.promise; return action(); },
    fetcher: fetcher((_url, init) => {
      if (init?.method === "PATCH") writes++;
      return response(record("owner-a", null, 0));
    }),
  });
  const refresh = client.refresh();
  await settled();
  client.reset();
  unlock.resolve();
  await refresh;
  assert.equal(writes, 0);
  assert.equal(client.getSnapshot().record, null);
  assert.equal(storage.getItem(APPEARANCE_LEGACY_OWNER_KEY), null);
});
