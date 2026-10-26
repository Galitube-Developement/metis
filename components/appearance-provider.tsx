"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { type ThemeDefinition } from "@/lib/appearance-theme";
import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  applyAppearanceTheme,
  createDefaultAppearanceState,
  createCustomTheme,
  deleteCustomTheme,
  getSelectedTheme,
  persistAppearanceState,
  readAppearanceState,
  selectAppearanceTheme,
  updateCustomTheme,
  type AppearanceState,
} from "@/lib/appearance-storage";
import {
  createAppearanceAccountClient,
  type AppearanceAccountRecord,
  type AppearanceAccountSnapshot,
} from "@/lib/appearance-account-client";

type AppearanceContextValue = {
  state: AppearanceState;
  theme: ThemeDefinition;
  ready: boolean;
  busy: boolean;
  canEdit: boolean;
  persistence: "account" | "local";
  syncError: string;
  refresh: () => void;
  choose: (id: string) => void | Promise<void>;
  save: (theme: ThemeDefinition, id?: string) => string | Promise<string>;
  remove: (id: string) => void | Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

type AppearanceProviderProps = {
  children: ReactNode;
  mode?: "account" | "local";
  initialAccount?: AppearanceAccountRecord | null;
};

/** The static demo explicitly retains its independent local-only adapter. */
export function AppearanceProvider({ children, mode = "local", initialAccount }: AppearanceProviderProps) {
  return mode === "account"
    ? <AccountAppearanceProvider initialAccount={initialAccount}>{children}</AccountAppearanceProvider>
    : <LocalAppearanceProvider>{children}</LocalAppearanceProvider>;
}

function AccountAppearanceProvider({ children, initialAccount }: AppearanceProviderProps) {
  const initial = useRef(initialAccount);
  const [snapshot, setSnapshot] = useState<AppearanceAccountSnapshot>(() => ({
    record: initialAccount ?? null, ready: initialAccount !== undefined, busy: false, error: "",
  }));
  const clientRef = useRef<ReturnType<typeof createAppearanceAccountClient> | null>(null);

  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Account persistence does not depend on browser storage. */ }
    const apply = (next: AppearanceAccountSnapshot) => {
      const state = next.record?.state ?? createDefaultAppearanceState();
      applyAppearanceTheme(document.documentElement, getSelectedTheme(state), state.selected);
      setSnapshot(next);
    };
    const client = createAppearanceAccountClient({
      initialRecord: initial.current, storage, onChange: apply,
      withMigrationLock: <T,>(action: () => Promise<T>) => navigator.locks
        ? navigator.locks.request("metis-theme-legacy-migration", action)
        : action(),
    });
    clientRef.current = client;
    apply(client.getSnapshot());
    void client.refresh();
    const refresh = () => { if (document.visibilityState !== "hidden") void client.refresh(); };
    const authChanged = () => {
      // Remove the old account's theme immediately, before fetching the new session.
      client.reset();
      void client.refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("metis:auth-changed", authChanged);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("metis:auth-changed", authChanged);
      document.removeEventListener("visibilitychange", refresh);
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, []);

  const client = useCallback(() => {
    if (!clientRef.current) throw new Error("Theme settings are still loading. Please try again.");
    return clientRef.current;
  }, []);
  const choose = useCallback(async (id: string) => {
    await client().mutate((state) => selectAppearanceTheme(state, id));
  }, [client]);
  const save = useCallback(async (theme: ThemeDefinition, id?: string) => {
    const record = await client().mutate((state) => id ? updateCustomTheme(state, id, theme) : createCustomTheme(state, theme));
    return record.state!.selected;
  }, [client]);
  const remove = useCallback(async (id: string) => {
    await client().mutate((state) => deleteCustomTheme(state, id));
  }, [client]);
  const refresh = useCallback(() => { void clientRef.current?.refresh(); }, []);
  const state = snapshot.record?.state ?? createDefaultAppearanceState();
  return <AppearanceContext.Provider value={{
    state, theme: getSelectedTheme(state), ready: snapshot.ready,
    busy: snapshot.busy, canEdit: !!snapshot.record, persistence: "account", syncError: snapshot.error,
    refresh, choose, save, remove,
  }}>{children}</AppearanceContext.Provider>;
}

function LocalAppearanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDefaultAppearanceState);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const apply = useCallback((next: AppearanceState) => {
    applyAppearanceTheme(document.documentElement, getSelectedTheme(next), next.selected);
    current.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    const restore = () => {
      let next = createDefaultAppearanceState();
      try { next = readAppearanceState(window.localStorage); } catch { /* Use the default. */ }
      apply(next);
      setReady(true);
    };
    restore();
    const sync = (event: StorageEvent) => {
      if (event.key === null || event.key === APPEARANCE_STORAGE_KEY || event.key === LEGACY_APPEARANCE_STORAGE_KEY) restore();
    };
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", restore);
    };
  }, [apply]);
  const commit = useCallback((next: AppearanceState) => {
    persistAppearanceState(window.localStorage, next);
    apply(next);
  }, [apply]);
  const choose = useCallback((id: string) => { commit(selectAppearanceTheme(current.current, id)); }, [commit]);
  const save = useCallback((theme: ThemeDefinition, id?: string) => {
    const next = id ? updateCustomTheme(current.current, id, theme) : createCustomTheme(current.current, theme);
    commit(next);
    return next.selected;
  }, [commit]);
  const remove = useCallback((id: string) => { commit(deleteCustomTheme(current.current, id)); }, [commit]);
  return <AppearanceContext.Provider value={{
    state, theme: getSelectedTheme(state), ready, busy: false, canEdit: true, persistence: "local",
    syncError: "", refresh: () => {}, choose, save, remove,
  }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("Appearance controls must be inside AppearanceProvider.");
  return context;
}
