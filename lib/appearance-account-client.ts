import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  MAX_APPEARANCE_STATE_BYTES,
  createDefaultAppearanceState,
  normalizeAppearanceState,
  type AppearanceState,
} from "./appearance-storage";
import { resolveThemeVariables, type ThemeDefinition } from "./appearance-theme";

export const APPEARANCE_LEGACY_OWNER_KEY = "metis-appearance-legacy-owner";
const MAX_RESPONSE_BYTES = MAX_APPEARANCE_STATE_BYTES + 16 * 1024;
const CANCELLED = "The appearance change was cancelled because the account changed.";
const LOAD_FAILED = "Appearance settings could not be loaded. Try again.";
const SAVE_FAILED = "Appearance changes could not be saved. Try again.";
const INVALID_RESPONSE = "The server returned invalid appearance settings. Refresh and try again.";
const SIGNED_OUT = "Sign in again to save appearance settings.";
const ACCOUNT_CHANGED = "Your account changed. Refresh appearance settings before saving.";
const CONFLICT = "Appearance settings changed on another device. Review the latest theme and save again.";

export interface AppearanceAccountRecord {
  ownerId: string;
  state: AppearanceState | null;
  revision: number;
}

export interface AppearanceAccountSnapshot {
  record: AppearanceAccountRecord | null;
  ready: boolean;
  busy: boolean;
  error: string;
}

export interface AppearanceStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AppearanceAccountClientOptions {
  initialRecord?: AppearanceAccountRecord | null;
  fetcher?: typeof fetch;
  storage?: AppearanceStorageLike;
  onChange?: (snapshot: AppearanceAccountSnapshot) => void;
  withMigrationLock?: <T>(action: () => Promise<T>) => Promise<T>;
}

export interface AppearanceAccountClient {
  getSnapshot(): AppearanceAccountSnapshot;
  refresh(): Promise<void>;
  mutate(transform: (state: AppearanceState) => AppearanceState): Promise<AppearanceAccountRecord>;
  reset(): void;
  dispose(): void;
}

class AppearanceClientError extends Error {}

// A successful migration remains claimed in this document even if the browser
// permits reading storage but denies later marker writes or key removal.
const confirmedLegacyOwners = new WeakMap<AppearanceStorageLike, string>();

function normalizeRecord(input: unknown): AppearanceAccountRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(INVALID_RESPONSE);
  const record = input as Record<string, unknown>;
  if (
    typeof record.ownerId !== "string" || !record.ownerId.trim() || record.ownerId.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(record.ownerId) ||
    typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 0 ||
    !Object.hasOwn(record, "state")
  ) {
    throw new Error(INVALID_RESPONSE);
  }
  return {
    ownerId: record.ownerId,
    state: record.state === null ? null : normalizeAppearanceState(record.state),
    revision: record.revision,
  };
}

async function readRecord(response: Response): Promise<AppearanceAccountRecord> {
  try {
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error(INVALID_RESPONSE);
    }
    if (!response.body) throw new Error(INVALID_RESPONSE);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let json = "";
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error(INVALID_RESPONSE);
        }
        json += decoder.decode(result.value, { stream: true });
      }
      json += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return normalizeRecord(JSON.parse(json));
  } catch {
    throw new AppearanceClientError(INVALID_RESPONSE);
  }
}

function themeContent(theme: ThemeDefinition): string {
  return JSON.stringify({
    name: theme.name,
    mode: theme.mode,
    variables: Object.entries(resolveThemeVariables(theme)).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0),
  });
}

function stableMigrationId(id: string, content: string): string {
  let hash = 0x811c9dc5;
  const value = id + "\n" + content;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return "custom-migrated-" + (hash >>> 0).toString(16).padStart(8, "0");
}

interface MigrationPlan {
  state: AppearanceState;
  originalState: string | null;
  originalSelection: string | null;
}

function migrationPlan(
  storage: AppearanceStorageLike | undefined,
  record: AppearanceAccountRecord,
  pendingOwner: string | undefined,
): MigrationPlan | null {
  if (!storage || (pendingOwner && pendingOwner !== record.ownerId)) return null;
  let originalState: string | null;
  let originalSelection: string | null;
  try {
    if (confirmedLegacyOwners.has(storage) || storage.getItem(APPEARANCE_LEGACY_OWNER_KEY)) return null;
    originalState = storage.getItem(APPEARANCE_STORAGE_KEY);
    originalSelection = storage.getItem(LEGACY_APPEARANCE_STORAGE_KEY);
  } catch {
    // Browser storage is optional; denied access cannot block account settings.
    return null;
  }
  if (!originalState && originalSelection !== "graphite" && originalSelection !== "midnight") return null;

  let legacy: AppearanceState;
  if (originalState) {
    if (new TextEncoder().encode(originalState).byteLength > MAX_APPEARANCE_STATE_BYTES) {
      throw new Error("Browser themes exceed the 512 KiB migration limit.");
    }
    legacy = normalizeAppearanceState(JSON.parse(originalState));
  } else {
    legacy = { ...createDefaultAppearanceState(), selected: originalSelection === "graphite" ? "graphite" : "midnight" };
  }

  const base = record.state ?? createDefaultAppearanceState();
  const customThemes = [...base.customThemes];
  const contentIds = new Map(customThemes.map((item) => [themeContent(item.theme), item.id]));
  const usedIds = new Set(customThemes.map((item) => item.id));
  const importedIds = new Map<string, string>();
  for (const item of legacy.customThemes) {
    const content = themeContent(item.theme);
    const duplicate = contentIds.get(content);
    if (duplicate) {
      importedIds.set(item.id, duplicate);
      continue;
    }
    let id = item.id;
    if (usedIds.has(id)) {
      const generated = stableMigrationId(item.id, content);
      id = generated;
      let suffix = 2;
      while (usedIds.has(id)) id = generated + "-" + suffix++;
    }
    customThemes.push({ id, theme: item.theme });
    usedIds.add(id);
    contentIds.set(content, id);
    importedIds.set(item.id, id);
  }
  const selected = record.state !== null ? base.selected : importedIds.get(legacy.selected) ?? legacy.selected;
  return {
    state: normalizeAppearanceState({ version: 1, selected, customThemes }),
    originalState,
    originalSelection,
  };
}

function claimMigration(storage: AppearanceStorageLike | undefined, ownerId: string, plan: MigrationPlan): void {
  if (!storage) return;
  try {
    const existingOwner = storage.getItem(APPEARANCE_LEGACY_OWNER_KEY);
    if (existingOwner && existingOwner !== ownerId) return;
  } catch {
    // The confirmed account write still succeeded.
  }
  confirmedLegacyOwners.set(storage, ownerId);
  try { storage.setItem(APPEARANCE_LEGACY_OWNER_KEY, ownerId); } catch { /* Optional browser bookkeeping. */ }
  // Do not erase a legacy payload that another (older) tab replaced mid-save.
  try {
    if (storage.getItem(APPEARANCE_STORAGE_KEY) === plan.originalState) storage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch { /* Optional browser bookkeeping. */ }
  try {
    if (storage.getItem(LEGACY_APPEARANCE_STORAGE_KEY) === plan.originalSelection) storage.removeItem(LEGACY_APPEARANCE_STORAGE_KEY);
  } catch { /* Optional browser bookkeeping. */ }
}

function migrationWarning(failure: unknown): string {
  const detail = failure instanceof SyntaxError ? "The browser theme JSON is invalid."
    : failure instanceof Error ? failure.message : "The browser themes are invalid.";
  return "Themes saved in this browser could not be imported. " + detail;
}

/**
 * Account settings own the theme. Browser storage is used only for a one-time
 * legacy import, never as an account-state cache. Requests and storage are
 * injectable so account transitions and deferred responses can be tested.
 */
export function createAppearanceAccountClient(options: AppearanceAccountClientOptions = {}): AppearanceAccountClient {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const withMigrationLock = options.withMigrationLock ?? (async <T>(action: () => Promise<T>) => action());
  let snapshot: AppearanceAccountSnapshot = {
    record: null,
    ready: options.initialRecord !== undefined,
    busy: false,
    error: "",
  };
  if (options.initialRecord) {
    try { snapshot.record = normalizeRecord(options.initialRecord); }
    catch { snapshot.error = INVALID_RESPONSE; }
  }
  let epoch = 0;
  let disposed = false;
  let controller: AbortController | null = null;
  let refreshPromise: Promise<void> | null = null;
  let pendingMigration: { epoch: number; ownerId: string } | undefined;

  function publish(change: Partial<AppearanceAccountSnapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    options.onChange?.(snapshot);
  }
  function active(requestEpoch: number) {
    return !disposed && epoch === requestEpoch;
  }
  function assertActive(requestEpoch: number) {
    if (!active(requestEpoch)) throw new AppearanceClientError(CANCELLED);
  }
  function errorMessage(failure: unknown, fallback: string) {
    return failure instanceof AppearanceClientError ? failure.message : fallback;
  }

  async function patch(
    previous: AppearanceAccountRecord,
    state: AppearanceState,
    requestEpoch: number,
    signal: AbortSignal,
  ): Promise<AppearanceAccountRecord> {
    let response: Response;
    try {
      response = await fetcher("/api/appearance", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: previous.ownerId, state, revision: previous.revision }),
        signal,
      });
    } catch {
      assertActive(requestEpoch);
      throw new AppearanceClientError(SAVE_FAILED);
    }
    assertActive(requestEpoch);
    if (response.status === 401) {
      publish({ record: null, ready: true, busy: false, error: SIGNED_OUT });
      throw new AppearanceClientError(SIGNED_OUT);
    }
    if (response.status !== 200 && response.status !== 409) throw new AppearanceClientError(SAVE_FAILED);
    const record = await readRecord(response);
    assertActive(requestEpoch);
    if (record.ownerId !== previous.ownerId) {
      publish({ record: null, ready: true, busy: false, error: ACCOUNT_CHANGED });
      throw new AppearanceClientError(ACCOUNT_CHANGED);
    }
    if (record.revision < previous.revision) throw new AppearanceClientError(INVALID_RESPONSE);
    if (response.status === 409) {
      publish({ record, ready: true, busy: false, error: CONFLICT });
      throw new AppearanceClientError(CONFLICT);
    }
    if (record.state === null) throw new AppearanceClientError(INVALID_RESPONSE);
    return record;
  }

  function transformed(
    state: AppearanceState,
    transform: (state: AppearanceState) => AppearanceState,
  ): AppearanceState {
    try {
      // The callback may mutate its argument, but it cannot mutate a confirmed
      // snapshot while an asynchronous save is still pending.
      return normalizeAppearanceState(transform(normalizeAppearanceState(state)));
    } catch (failure) {
      throw new AppearanceClientError(failure instanceof Error ? failure.message : "The appearance change is invalid.");
    }
  }

  async function migrate(
    previous: AppearanceAccountRecord,
    requestEpoch: number,
    signal: AbortSignal,
    transform?: (state: AppearanceState) => AppearanceState,
  ): Promise<{ record?: AppearanceAccountRecord; warning: string }> {
    try {
      if (!migrationPlan(options.storage, previous, pendingMigration?.ownerId)) return { warning: "" };
    } catch (failure) {
      return { warning: migrationWarning(failure) };
    }
    publish({ busy: true });
    return withMigrationLock(async () => {
      assertActive(requestEpoch);
      let plan: MigrationPlan | null;
      try {
        // Another tab may have claimed or changed the legacy payload while this
        // request waited for the browser-wide migration lock.
        plan = migrationPlan(options.storage, previous, pendingMigration?.ownerId);
      } catch (failure) {
        return { warning: migrationWarning(failure) };
      }
      if (!plan) return { warning: "" };
      pendingMigration = { epoch: requestEpoch, ownerId: previous.ownerId };
      try {
        const state = transform ? transformed(plan.state, transform) : plan.state;
        const record = await patch(previous, state, requestEpoch, signal);
        assertActive(requestEpoch);
        claimMigration(options.storage, previous.ownerId, plan);
        return { record, warning: "" };
      } finally {
        if (pendingMigration?.epoch === requestEpoch) pendingMigration = undefined;
      }
    });
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (refreshPromise) return refreshPromise;
    if (snapshot.busy) return Promise.resolve();
    controller?.abort();
    const requestEpoch = ++epoch;
    const requestController = new AbortController();
    controller = requestController;
    publish({ error: "" });
    const operation = (async () => {
      try {
        const response = await fetcher("/api/appearance", {
          method: "GET", credentials: "same-origin", cache: "no-store", signal: requestController.signal,
        });
        assertActive(requestEpoch);
        if (response.status === 401) {
          publish({ record: null, ready: true, busy: false, error: "" });
          return;
        }
        if (response.status !== 200) throw new AppearanceClientError(LOAD_FAILED);
        const record = await readRecord(response);
        assertActive(requestEpoch);
        if (snapshot.record?.ownerId === record.ownerId && record.revision < snapshot.record.revision) {
          throw new AppearanceClientError(LOAD_FAILED);
        }
        publish({ record, ready: true });
        const result = await migrate(record, requestEpoch, requestController.signal);
        assertActive(requestEpoch);
        publish({ record: result.record ?? record, ready: true, busy: false, error: result.warning });
      } catch (failure) {
        if (active(requestEpoch)) {
          publish({ ready: true, busy: false, error: errorMessage(failure, LOAD_FAILED) });
        }
      } finally {
        if (controller === requestController) controller = null;
      }
    })();
    refreshPromise = operation;
    void operation.finally(() => {
      if (refreshPromise === operation) refreshPromise = null;
    });
    return operation;
  }

  async function mutate(transform: (state: AppearanceState) => AppearanceState): Promise<AppearanceAccountRecord> {
    if (disposed) throw new AppearanceClientError(CANCELLED);
    if (snapshot.busy) throw new AppearanceClientError("An appearance change is already being saved. Wait and try again.");
    const previous = snapshot.record;
    if (!previous) {
      throw new AppearanceClientError(snapshot.ready ? SIGNED_OUT : "Appearance settings are still loading. Refresh and try again.");
    }
    controller?.abort();
    refreshPromise = null;
    const requestEpoch = ++epoch;
    const requestController = new AbortController();
    controller = requestController;
    publish({ busy: true, error: "" });
    try {
      const migration = await migrate(previous, requestEpoch, requestController.signal, transform);
      assertActive(requestEpoch);
      const record = migration.record ?? await patch(
        previous,
        transformed(previous.state ?? createDefaultAppearanceState(), transform),
        requestEpoch,
        requestController.signal,
      );
      assertActive(requestEpoch);
      publish({ record, ready: true, busy: false, error: migration.warning });
      return record;
    } catch (failure) {
      const message = errorMessage(failure, SAVE_FAILED);
      if (active(requestEpoch)) publish({ ready: true, busy: false, error: message });
      throw new AppearanceClientError(active(requestEpoch) ? message : CANCELLED);
    } finally {
      if (controller === requestController) controller = null;
    }
  }

  return {
    getSnapshot: () => snapshot,
    refresh,
    mutate,
    reset() {
      epoch++;
      controller?.abort();
      controller = null;
      refreshPromise = null;
      publish({ record: null, ready: false, busy: false, error: "" });
    },
    dispose() {
      epoch++;
      controller?.abort();
      controller = null;
      refreshPromise = null;
      disposed = true;
      snapshot = { record: null, ready: false, busy: false, error: "" };
    },
  };
}
