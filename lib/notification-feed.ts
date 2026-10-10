import type { NotificationRecord, NotificationPrefs } from "./notification-store";
export type NotificationFeed = {
  notifications: NotificationRecord[];
  cursor: number;
  hasMore: boolean;
  prefs: NotificationPrefs;
  clients: Array<{ id: string; name: string; status: string; nativeNotifications: boolean }>;
};
/** One consumer per signed-in account. Bootstrap with GET without after.
 * Advance the cursor before triggering UI alerts, and serialize polling.
 * Both channels use the same records; never alert from run SSE as well.
 */
export function consumeNotificationFeed(feed: NotificationFeed, cursor: number) {
  const notifications = feed.notifications.filter(record => record.sequence > cursor);
  return { notifications, cursor: Math.max(cursor, feed.cursor) };
}
