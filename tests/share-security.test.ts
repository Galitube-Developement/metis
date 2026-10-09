import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { IncomingMessage } from "node:http";
import { initializeRequestNetwork, stampRequestNetwork } from "../lib/request-network";

const data = mkdtempSync(path.join(os.tmpdir(), "metis-share-security-"));
process.env.CHAT_DATA_DIR = data;
process.env.CHAT_DB_PATH = path.join(data, "chat.sqlite");
process.env.AGENT_CWD = data;
process.env.AI_CHAT_ROOT = data;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
delete process.env.CHAT_PASSWORD;
initializeRequestNetwork();
after(async () => { (await import("../lib/sqlite")).getDatabase().close(); rmSync(data, { recursive: true, force: true }); });

test("share password attempts cannot rotate headers or alternate read and clone endpoints", async () => {
  const { createUser, authenticateUser } = await import("../lib/auth");
  const db = await import("../lib/db-store");
  const { POST: read } = await import("../app/api/share/route");
  const { POST: clone } = await import("../app/api/share/clone/route");
  const user = createUser("synthetic-share-user", "synthetic-share-password");
  const token = authenticateUser(user.username, "synthetic-share-password")!.token;
  const chat = db.createChat("synthetic protected share", undefined, user.id);
  const shared = db.updateChatShare(chat.id, { active: true, password: "correct-share-password" }, user.id)!;
  for (let index = 0; index < 12; index++) {
    const req = new Request("http://localhost/api/share", {
      method: "POST", headers: { "content-type": "application/json", cookie: "ai_chat_auth=" + token,
        "x-real-ip": "198.51.100." + index, "x-forwarded-for": "203.0.113." + index },
      body: JSON.stringify({ id: shared.share!.id, password: "wrong-share-password" }),
    });
    const response = await (index % 2 ? clone : read)(req);
    assert.equal(response.status, index >= 10 ? 429 : index % 2 ? 404 : 401);
  }
});

test("share target budget also caps attempts from distinct real peers", async () => {
  const { consumeSharePasswordLimit } = await import("../lib/share-rate-limit");
  for (let index = 0; index < 32; index++) {
    const incoming = { headers: {}, socket: { remoteAddress: "198.51.100." + index } } as IncomingMessage;
    stampRequestNetwork(incoming);
    const req = new Request("http://localhost", { headers: incoming.headers as Record<string, string> });
    assert.equal(consumeSharePasswordLimit(req, "synthetic-distributed-share").allowed, index < 30);
  }
});
