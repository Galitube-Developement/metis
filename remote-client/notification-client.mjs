import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function createNotificationReceiver({ config, configPath, available, show }) {
  const scope = createHash("sha256").update(String(config.server) + ":" + String(config.clientId) + ":" + String(config.credential)).digest("hex");
  const file = path.join(path.dirname(configPath), "notifications-" + scope + ".json");
  let seen = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(saved)) seen = new Map(saved.filter(row => Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "number" && Date.now() - row[1] < 86400000).slice(-2048));
  } catch {}
  const inFlight = new Map();
  function validate(n) {
    return n && typeof n === "object" && typeof n.id === "string" && n.id.length <= 200 && n.id.length > 0 &&
      typeof n.title === "string" && n.title.length > 0 && n.title.length <= 160 &&
      typeof n.body === "string" && n.body.length <= 2000 &&
      (n.chatId === null || (typeof n.chatId === "string" && n.chatId.length > 0 && n.chatId.length <= 200)) &&
      typeof n.createdAt === "string" && Number.isFinite(Date.parse(n.createdAt)) &&
      Date.now() - Date.parse(n.createdAt) < 86400000 && Date.parse(n.createdAt) <= Date.now() + 60000;
  }
  async function display(n) {
    // Pass only the safe notification fields. No URL, command, icon, or arbitrary action.
    await show({ id:n.id, title:n.title, body:n.body, chatId:n.chatId, createdAt:n.createdAt });
    seen.set(n.id, Date.now());
    seen = new Map([...seen].filter(([,at]) => Date.now() - at < 86400000).slice(-2048));
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify([...seen]), {mode:0o600});
    fs.renameSync(tmp, file);
  }
  return async message => {
    const n = message?.notification;
    if (typeof message?.requestId !== "string" || message.requestId.length > 200 || !validate(n)) return null;
    const ack = { type:"notification_ack", requestId:message.requestId, notificationId:n.id, ok:false };
    if (seen.has(n.id)) return {...ack,ok:true};
    if (available() !== true || typeof show !== "function") return ack;
    try {
      if (!inFlight.has(n.id)) {
        const promise = display(n).finally(() => inFlight.delete(n.id));
        inFlight.set(n.id,promise);
      }
      await inFlight.get(n.id);
      return {...ack,ok:true};
    } catch { return ack; }
  };
}
