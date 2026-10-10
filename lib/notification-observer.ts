import { notificationDatabase, createNotification, getNotificationPrefs, type NotificationRecord } from "@/lib/notification-store";
import { sendRemoteNotification } from "@/lib/notification-remote";
import { transaction } from "@/lib/sqlite";

// A durable cursor and source keys make replay/restart idempotent across processes.
export function observeNotificationEvents() {
  const db = notificationDatabase();
  return transaction(() => {
    const { cursor } = db.prepare("SELECT cursor FROM notification_observer WHERE key='runs'").get() as {cursor:number};
    const { tail } = db.prepare("SELECT COALESCE(MAX(id),0) AS tail FROM run_events").get() as {tail:number};
    const events = db.prepare(`SELECT e.id,e.job_id,e.chat_id,e.user_id,e.event,e.data,e.created_at
      FROM run_events e WHERE e.id>? AND e.id<=? AND e.event IN ('done','error','question','status','workspace') ORDER BY e.id LIMIT 500`).all(cursor,tail) as Array<Record<string, unknown>>;
    for (const event of events) {
      const ownerId = String(event.user_id || "");
      if (!ownerId || !["done", "error", "question", "status", "workspace"].includes(String(event.event))) continue;
      if (!db.prepare("SELECT 1 FROM chats WHERE id=? AND owner_id=?").get(String(event.chat_id), ownerId)) continue;
      let data: Record<string, unknown> = {};
      try { const parsed = JSON.parse(String(event.data)); if (parsed && typeof parsed === "object") data = parsed; } catch {}
      const kind = String(event.event);
      if (kind === "status") {
        if (data.status !== "waiting_provider_limit" || typeof data.resetAt !== "string" || !Number.isFinite(Date.parse(data.resetAt))) continue;
        const resetAt = new Date(data.resetAt).toISOString();
        createNotification(ownerId, {
          title: "Provider limit reached",
          body: `The run will continue automatically after ${resetAt}.`,
          chatId: String(event.chat_id),
        }, `run:${ownerId}:provider-limit:${String(event.job_id)}:${resetAt}`, String(event.created_at));
        continue;
      }
      if (kind === "workspace") {
        const workspace = data.workspace as Record<string, unknown> | undefined;
        if (!workspace || workspace.type !== "plan" || typeof workspace.id !== "string") continue;
        createNotification(ownerId, { title: "Plan ready", body: "Open the chat to review the plan.", chatId: String(event.chat_id) },
          `run:${ownerId}:plan:${String(event.job_id)}:${workspace.id}`, String(event.created_at));
        continue;
      }
      if (kind === "done" && typeof data.status === "string" &&
          !["finished", "completed", "success", "succeeded", "done"].includes(data.status.toLowerCase())) continue;
      // Never copy run output/tool payloads or error stacks into OS notifications.
      const title = kind === "done" ? "Run completed" : kind === "error" ? "Run failed" : "Answer needed";
      const body = kind === "question" ? "A question is waiting for your answer in the chat." : kind === "error" ? "Open the chat for details." : "The result is available in the chat.";
      const source = kind === "question" ? String(data.questionId || event.id) : String(event.job_id);
      createNotification(ownerId, { title, body, chatId: String(event.chat_id) }, `run:${ownerId}:${kind}:${source}`, String(event.created_at));
    }
    const nextCursor = events.length === 500 ? Number(events[events.length - 1].id) : Math.max(cursor,tail);
    db.prepare("UPDATE notification_observer SET cursor=? WHERE key='runs'").run(nextCursor);
    return events.length;
  });
}
export async function deliverPendingNotifications(send = sendRemoteNotification) {
  const db = notificationDatabase();
  const rows = db.prepare(`SELECT n.id,n.sequence,n.owner_id AS ownerId,n.title,n.body,n.chat_id AS chatId,n.created_at AS createdAt,d.client_id AS clientId
    FROM notification_deliveries d JOIN notification_records n ON n.id=d.notification_id
    WHERE d.acknowledged_at IS NULL AND d.retry_at<=? ORDER BY n.sequence LIMIT 32`).all(Date.now()) as Array<NotificationRecord & {ownerId:string;clientId:string}>;
  await Promise.all(rows.map(async row => {
    if (!getNotificationPrefs(row.ownerId).remoteClientIds.includes(row.clientId) || Date.now() - Date.parse(row.createdAt) > 86400000) {
      db.prepare("DELETE FROM notification_deliveries WHERE notification_id=? AND client_id=?").run(row.id,row.clientId);
      return;
    }
    // Reserve before awaiting. A second observer cannot dispatch this same attempt.
    const claimed = db.prepare("UPDATE notification_deliveries SET retry_at=?,attempts=attempts+1 WHERE notification_id=? AND client_id=? AND retry_at<=? AND acknowledged_at IS NULL")
      .run(Date.now()+30000,row.id,row.clientId,Date.now());
    if (!claimed.changes) return;
    const { ownerId, clientId, ...notification } = row;
    const acknowledged = await send(clientId, ownerId, notification).catch(() => false);
    if (acknowledged) db.prepare("UPDATE notification_deliveries SET acknowledged_at=? WHERE notification_id=? AND client_id=?")
      .run(new Date().toISOString(),row.id,row.clientId);
  }));
}
export function startNotificationObserver() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { observeNotificationEvents(); await deliverPendingNotifications(); }
    catch (error) { console.warn("[notifications] Observer failed", error instanceof Error ? error.message : "Unknown error"); }
    finally { busy = false; }
  };
  // Initialize synchronously before accepting requests/worker events.
  notificationDatabase();
  const timer = setInterval(() => { void tick(); }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
