/* eslint-disable @typescript-eslint/no-require-imports */
const activeNotifications = new Set();
function notificationChatUrl(server, chatId) {
  const base = new URL(server);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid Metis server URL");
  const url = new URL("/",base.origin);
  if (chatId != null) {
    if (typeof chatId !== "string" || !chatId.length || chatId.length > 200) throw new Error("Invalid chat");
    url.searchParams.set("c",chatId);
  }
  return url.href;
}
function showNativeNotification({ Notification, openExternal, server, notification, timeoutMs = 10000 }) {
  if (!Notification.isSupported()) return Promise.reject(new Error("Native notifications unavailable"));
  const url = notificationChatUrl(server,notification.chatId);
  return new Promise((resolve,reject) => {
    const native = new Notification({title:notification.title,body:notification.body});
    activeNotifications.add(native);
    native.once("close", () => activeNotifications.delete(native));
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Native notification show timed out")),timeoutMs);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { activeNotifications.delete(native); native.close?.(); reject(error); } else resolve();
    }
    native.once("show",() => finish());
    native.once("failed",() => finish(new Error("Native notification failed")));
    native.on("click",() => {
      try { Promise.resolve(openExternal(url)).catch(() => {}); } catch {}
    });
    try { native.show(); } catch(error) { finish(error); }
  });
}
module.exports = { notificationChatUrl, showNativeNotification };
