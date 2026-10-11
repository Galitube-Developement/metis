import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

test("desktop transfers preserve binary contents, isolate owners, expire tickets and never overwrite names", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-transfer-"));
  Object.assign(process.env, { AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root,
    CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_SECRETS_KEY: "transfer-test", NODE_ENV: "test",
    AI_CHAT_PUBLIC_URL: "http://transfer.test" });
  const auth = await import("../lib/auth"), clients = await import("../lib/remote-clients");
  const store = await import("../lib/file-upload-store"), gateway = await import("../lib/remote-client-gateway");
  const transfers = await import("../lib/remote-file-transfer");
  const api = await import("../app/api/remote-clients/[id]/files/route");
  const owner = auth.createUser("transfer-owner", "test-password"), other = auth.createUser("transfer-other", "test-password");
  const session = auth.authenticateUser("transfer-owner", "test-password")!;
  const otherSession = auth.authenticateUser("transfer-other", "test-password")!;
  const client = clients.registerRemoteClient(clients.createEnrollmentToken(owner.id, undefined, "admin").token,
    { name: "Transfer fixture", permissionMode: "admin", os: "darwin", capabilities: ["desktop_gui"] })!.client!;
  const binary = new Uint8Array([0, 1, 127, 128, 255]);
  const upload = store.createUpload(owner.id, { name: "sample.bin", mimeType: "application/octet-stream", size: binary.length });
  await store.appendUpload(owner.id, upload.id, 0, new ReadableStream({ start(c) { c.enqueue(binary); c.close(); } }));
  store.completeUpload(owner.id, upload.id);
  const urls: string[] = [], require = createRequire(import.meta.url);
  const socket = new EventEmitter() as EventEmitter & { readyState: number; send(data: string): void; close(): void };
  socket.readyState = 1; socket.close = () => { socket.readyState = 3; socket.emit("close"); };
  socket.send = wire => {
    const request = JSON.parse(wire);
    if (request.type !== "request") return;
    assert.equal(request.action, "execute_command");
    const encoded = request.params.command.match(/Buffer.from\('([^']+)'/)[1];
    const script = Buffer.from(encoded, "base64").toString();
    let stdout = "", stderr = "";
    const fixtureProcess = { platform: "darwin", exitCode: 0 };
    Promise.resolve(vm.runInNewContext(script, {
      require: (name: string) => name === "os" ? { homedir: () => root } : require(name),
      Buffer, process: fixtureProcess, AbortSignal,
      console: { log: (value: string) => { stdout += value; }, error: (value: string) => { stderr += value; } },
      fetch: async (url: string) => {
        urls.push(url);
        const response = transfers.remoteTransferDownload(new URL(url).pathname.split("/").at(-1)!, new Request(url));
        assert.equal(response.headers.get("Cache-Control"), "private, no-store");
        return response;
      },
    })).then(() => socket.emit("message", JSON.stringify({ type: "response", requestId: request.requestId,
      ok: fixtureProcess.exitCode === 0, error: stderr, result: { stdout, stderr, exitCode: fixtureProcess.exitCode } })));
  };
  gateway.attachRemoteClient(socket, client.id, owner.id);
  const context = { params: Promise.resolve({ id: client.id }) };
  const request = (token?: string, id = upload.id) => new Request("http://test/api/remote-clients/" + client.id + "/files",
    { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { cookie: "ai_chat_auth=" + token } : {}) }, body: JSON.stringify({ uploadId: id }) });
  try {
    assert.equal((await api.POST(request(), context)).status, 401);
    assert.equal((await api.POST(request(otherSession.token), context)).status, 400);
    assert.equal(urls.length, 0);
    for (const name of ["sample.bin", "sample (1).bin"]) {
      const response = await api.POST(request(session.token), context); assert.equal(response.status, 200);
      const saved = await response.json(); assert.equal(saved.path, path.join(root, "Desktop", name));
      assert.deepEqual(new Uint8Array(readFileSync(saved.path)), binary);
      const expiredUrl = urls.at(-1)!;
      assert.equal(transfers.remoteTransferDownload(new URL(expiredUrl).pathname.split("/").at(-1)!, new Request(expiredUrl)).status, 404);
    }
    assert.deepEqual(readdirSync(path.join(root, "Desktop")).sort(), ["sample (1).bin", "sample.bin"]);
    const incomplete = store.createUpload(owner.id, { name: "unfinished", mimeType: "text/plain", size: 4 });
    assert.equal((await api.POST(request(session.token, incomplete.id), context)).status, 400);
    clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "restricted", permissions: ["write_file"] } });
    const blocked = await api.POST(request(session.token), context);
    assert.equal(blocked.status, 400); assert.match((await blocked.json()).error, /Full access/);
    assert.equal(urls.length, 2);
    const windows = transfers.desktopTransferCommand("https://test/file", 'x"$().bin', 5, "windows");
    assert.match(windows, /^powershell.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    const code = Buffer.from(windows.split(" ").at(-1)!, "base64").toString("utf16le");
    assert.match(code, /GetFolderPath\('Desktop'\)/);
    assert.equal(transfers.remoteTransferDownload("unknown", new Request("http://test")).status, 404);
  } finally { socket.close(); rmSync(root, { recursive: true, force: true }); }
});
