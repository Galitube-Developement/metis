"use client";
import { useEffect, useRef } from "react";
import type { NotificationPrefs, NotificationRecord } from "@/lib/notification-store";

/** Serial polling avoids overlap; cursor is session-only so old alerts never replay on login. */
export function useAccountNotifications(enabled: boolean, deliver: (record: NotificationRecord, prefs: NotificationPrefs) => void, prefsChanged: (prefs: NotificationPrefs) => void) {
  const callbacks = useRef({ deliver, prefsChanged });
  callbacks.current = { deliver, prefsChanged };
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let cursor: number | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const seen = new Set<string>();
    const poll = async () => {
      controller = new AbortController();
      try {
        const response = await fetch("/api/notifications" + (cursor === undefined ? "" : "?after=" + cursor), { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Notification feed unavailable");
        const data = await response.json() as { cursor: number; notifications: NotificationRecord[]; prefs: NotificationPrefs; hasMore: boolean };
        if (stopped) return;
        callbacks.current.prefsChanged(data.prefs);
        cursor = data.cursor;
        for (const notification of data.notifications) {
          if (seen.has(notification.id)) continue;
          seen.add(notification.id);
          callbacks.current.deliver(notification, data.prefs);
        }
        if (seen.size > 500) { const old = [...seen].slice(0, seen.size - 250); old.forEach(id => seen.delete(id)); }
        timer = setTimeout(poll, data.hasMore ? 100 : 3000);
      } catch {
        if (!stopped) timer = setTimeout(poll, 10000);
      }
    };
    void poll();
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); };
  }, [enabled]);
}
