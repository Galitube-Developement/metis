import { notificationDatabase } from "./notification-store";
import { cleanupExpiredIncognitoChats } from "./db-store";
export { observeNotificationEvents, deliverPendingNotifications } from "./notification-observer";

// Housekeeping belongs off the HTTP thread too. Expired chats are already hidden
// by access checks; deleting their data no longer blocks sidebar polling.
let nextCleanupAt = 0;
export function maintain() {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 60_000;
  cleanupExpiredIncognitoChats();
}

// Short lock waits allow cooperative shutdown and retry on the next serial poll.
export function initialize() {
  notificationDatabase().exec("PRAGMA busy_timeout=250");
}
