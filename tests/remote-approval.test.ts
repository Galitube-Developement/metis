import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-remote-approval-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;

test("database initialization preserves an explicitly saved Full Access policy", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(path.join(process.cwd(), "lib/sqlite.ts"), "utf8");
  assert.doesNotMatch(source, /UPDATE remote_clients/);
});

test("new remote clients default to Full Access", async () => {
  const { createUser } = await import("../lib/auth");
  const { authorizeRemoteAction, createEnrollmentToken, registerRemoteClient } = await import("../lib/remote-clients");
  const owner = createUser("remote-owner", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "test-client" });
  assert.ok(registered?.client);
  assert.equal(registered.client.permissionMode, "user");
  assert.equal(registered.client.policy.mode, "full_access");
  assert.equal(authorizeRemoteAction(registered.client, "execute_command", "whoami").allowed, true);
  assert.equal(authorizeRemoteAction(registered.client, "write_file", { path: "notes.txt" }).allowed, true);
});

test("enrollment keeps the selected permission mode and rejects a mismatched client", async () => {
  const { createUser } = await import("../lib/auth");
  const { createEnrollmentToken, registerRemoteClient } = await import("../lib/remote-clients");
  const owner = createUser("remote-mode-owner", "password");
  const adminToken = createEnrollmentToken(owner.id, undefined, "admin").token;
  assert.equal(registerRemoteClient(adminToken, { permissionMode: "user" }), null);
  assert.equal(registerRemoteClient(adminToken, { permissionMode: "admin" })?.client?.permissionMode, "admin");
  const userToken = createEnrollmentToken(owner.id).token;
  assert.equal(registerRemoteClient(userToken, { permissionMode: "admin" }), null);
  assert.equal(registerRemoteClient(userToken, { permissionMode: "user" })?.client?.permissionMode, "user");
});

test("Computer Use defaults on for a Windows GUI client and remains website-controlled", async () => {
  const { createUser } = await import("../lib/auth");
  const { authorizeRemoteAction, createEnrollmentToken, getRemoteClient, registerRemoteClient, updateRemoteClient, updateRemoteClientDesktopCapability } = await import("../lib/remote-clients");
  const owner = createUser("remote-gui-owner", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, {
    name: "gui-device", os: "windows 10", capabilities: ["desktop_gui"], permissionMode: "user",
  });
  assert.ok(registered?.client);
  assert.equal(authorizeRemoteAction(registered.client, "computer_use", { operation: "list_windows" }).allowed, true);
  updateRemoteClient(registered.client.id, owner.id, { policy: {
    mode: "approval_required",
    permissions: registered.client.policy.permissions.filter((permission) => permission !== "computer_use"),
  } });
  const disabled = getRemoteClient(registered.client.id, owner.id);
  assert.ok(disabled);
  assert.equal(authorizeRemoteAction(disabled, "computer_use", { operation: "list_windows" }).allowed, false);
  updateRemoteClient(disabled.id, owner.id, { policy: { permissions: [...disabled.policy.permissions, "computer_use"] } });
  const enabled = getRemoteClient(disabled.id, owner.id);
  assert.ok(enabled);
  assert.equal(authorizeRemoteAction(enabled, "computer_use", { operation: "list_windows" }).allowed, true);
  updateRemoteClientDesktopCapability(enabled.id, false);
  const headless = getRemoteClient(enabled.id, owner.id);
  assert.ok(headless);
  assert.equal(authorizeRemoteAction(headless, "computer_use", { operation: "list_windows" }).allowed, false);
});

test("device permissions and owner-wide allowlist are enforced together", async () => {
  const { createUser } = await import("../lib/auth");
  const {
    authorizeRemoteAction, createEnrollmentToken, getGlobalRemoteAllowlist,
    getRemoteClient, registerRemoteClient, setGlobalRemoteAllowlist, updateRemoteClient,
  } = await import("../lib/remote-clients");
  const owner = createUser("remote-policy-owner", "password");
  const otherOwner = createUser("remote-policy-other", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, {
    name: "policy-device", permissionMode: "user",
  });
  assert.ok(registered?.client);
  updateRemoteClient(registered.client.id, owner.id, { policy: {
    mode: "approval_required",
    permissions: ["get_info", "list_directory", "read_file", "execute_command"],
  } });
  const initiallyRestricted = getRemoteClient(registered.client.id, owner.id);
  assert.ok(initiallyRestricted);
  assert.equal(authorizeRemoteAction(initiallyRestricted, "execute_command", "whoami").allowed, false);
  setGlobalRemoteAllowlist(owner.id, ["whoami", "whoami", "echo safe"]);
  assert.deepEqual(getGlobalRemoteAllowlist(owner.id), ["whoami", "echo safe"]);
  assert.deepEqual(getGlobalRemoteAllowlist(otherOwner.id), []);
  assert.equal(authorizeRemoteAction(initiallyRestricted, "execute_command", "whoami").allowed, true);
  assert.equal(authorizeRemoteAction(initiallyRestricted, "execute_command", "whoami & echo unsafe").allowed, false);
  updateRemoteClient(registered.client.id, owner.id, { policy: {
    permissions: ["get_info", "read_file", "write_file"],
    allowlist: ["echo device"],
  } });
  const client = getRemoteClient(registered.client.id, owner.id);
  assert.ok(client);
  assert.equal(authorizeRemoteAction(client, "execute_command", "whoami").allowed, false);
  assert.equal(authorizeRemoteAction(client, "execute_command", "echo device").allowed, false);
  assert.equal(authorizeRemoteAction(client, "list_directory").allowed, false);
  assert.equal(authorizeRemoteAction(client, "write_file", { path: "notes.txt" }).allowed, true);
  assert.equal(authorizeRemoteAction(client, "pty_open").allowed, false);
  updateRemoteClient(client.id, owner.id, { policy: { mode: "full_access" } });
  const fullAccessClient = getRemoteClient(client.id, owner.id);
  assert.ok(fullAccessClient);
  assert.equal(authorizeRemoteAction(fullAccessClient, "execute_command", "echo unrestricted").allowed, true);
  assert.equal(authorizeRemoteAction(fullAccessClient, "list_directory").allowed, true);
  assert.equal(authorizeRemoteAction(fullAccessClient, "pty_open").allowed, false);
  assert.equal(authorizeRemoteAction(fullAccessClient, "execute_command", "powershell Get-Service").allowed, false);
  assert.equal(authorizeRemoteAction(fullAccessClient, "read_file", { path: "Windows/system.ini" }).allowed, false);
  updateRemoteClient(client.id, owner.id, { policy: { mode: "approval_required" } });
  const restrictedAgain = getRemoteClient(client.id, owner.id);
  assert.ok(restrictedAgain);
  assert.equal(authorizeRemoteAction(restrictedAgain, "execute_command", "echo unrestricted").allowed, false);
  assert.equal(authorizeRemoteAction(restrictedAgain, "list_directory").allowed, false);
});

test("Full Access admin clients execute actions without an extra approval", async () => {
  const { createUser } = await import("../lib/auth");
  const { authorizeRemoteAction, createEnrollmentToken, getRemoteClient, registerRemoteClient } = await import("../lib/remote-clients");
  const { getDatabase } = await import("../lib/sqlite");
  const owner = createUser("remote-admin", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id, undefined, "admin").token, { name: "admin-client", permissionMode: "admin" });
  assert.ok(registered?.client);
  getDatabase().prepare("UPDATE remote_clients SET policy = ? WHERE id = ?").run(JSON.stringify({ mode: "full_access", allowlist: [] }), registered.client.id);
  const client = getRemoteClient(registered.client.id, owner.id);
  assert.ok(client);
  assert.equal(client.permissionMode, "admin");
  assert.equal(authorizeRemoteAction(client, "delete_file").requiresApproval, false);
  assert.equal(authorizeRemoteAction(client, "delete_file").allowed, true);
  assert.equal(authorizeRemoteAction(client, "execute_command", "echo unrestricted").allowed, true);
  assert.equal(authorizeRemoteAction(client, "execute_command", "echo unrestricted").requiresApproval, false);
});

test("remote MCP schema does not expose model-controlled approval", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(path.join(process.cwd(), "lib/mcp-core/gateway-core.mjs"), "utf8");
  assert.doesNotMatch(source, /args\.approved|approved: true/);
});

test("device hub audit records results, redacts output, and marks disconnects as unclear", async () => {
  const { createUser } = await import("../lib/auth");
  const { createEnrollmentToken, registerRemoteClient, updateRemoteClient, listRemoteAudit } = await import("../lib/remote-clients");
  const { attachRemoteClient, requestRemoteClient } = await import("../lib/remote-client-gateway");
  const owner = createUser("remote-hub-owner", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "hub-device" });
  assert.ok(registered?.client);
  updateRemoteClient(registered.client.id, owner.id, { policy: { mode: "full_access", allowlist: ["echo fail", "echo maybe"] } });

  function mockSocket(onRequest: (socket: EventEmitter, request: Record<string, unknown>) => void) {
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: (data: string) => void; close: () => void };
    socket.readyState = 1;
    socket.send = (data) => {
      const message = JSON.parse(data) as Record<string, unknown>;
      if (message.type === "request") queueMicrotask(() => onRequest(socket, message));
    };
    socket.close = () => {
      socket.readyState = 3;
      socket.emit("close");
    };
    return socket;
  }

  const socket = mockSocket((connection, request) => {
    connection.emit("message", JSON.stringify({
      type: "response", requestId: request.requestId, ok: false,
      error: "Command exited with code 1",
      result: { stdout: "", stderr: "token=abc", exitCode: 1 },
    }));
  });
  attachRemoteClient(socket, registered.client.id, owner.id);
  await assert.rejects(requestRemoteClient({
    clientId: registered.client.id, ownerId: owner.id, action: "execute_command", params: { command: "echo fail" },
  }), /Command exited/);
  const failed = listRemoteAudit(owner.id)[0];
  assert.equal(failed.status, "error");
  assert.equal(failed.resultData?.stderr, "token=[redacted]");
  assert.equal(failed.resultData?.exitCode, 1);
  assert.ok(failed.durationMs != null);

  const disconnected = mockSocket((connection) => connection.emit("close"));
  attachRemoteClient(disconnected, registered.client.id, owner.id);
  await assert.rejects(requestRemoteClient({
    clientId: registered.client.id, ownerId: owner.id, action: "execute_command", params: { command: "echo maybe" },
  }), /disconnected/);
  assert.equal(listRemoteAudit(owner.id)[0].status, "unknown");
  disconnected.close();
});

test("device hub returns only the authenticated PC and its logs", async () => {
  const { createUser } = await import("../lib/auth");
  const { createEnrollmentToken, registerRemoteClient } = await import("../lib/remote-clients");
  const { getDatabase } = await import("../lib/sqlite");
  const { GET } = await import("../app/api/remote-clients/hub/route");
  const owner = createUser("remote-local-hub", "password");
  const first = registerRemoteClient(createEnrollmentToken(owner.id, undefined, "admin").token, { name: "this-pc", permissionMode: "admin" });
  const second = registerRemoteClient(createEnrollmentToken(owner.id, undefined, "admin").token, { name: "other-pc", permissionMode: "admin" });
  assert.ok(first?.client && second?.client);
  for (const client of [first.client, second.client]) {
    getDatabase().prepare("INSERT INTO remote_audit (id, owner_id, client_id, source, action, request_data, status, created_at) VALUES (?, ?, ?, 'user', 'get_info', '{}', 'completed', ?)")
      .run(randomUUID(), owner.id, client.id, new Date().toISOString());
  }
  const response = await GET(new Request("http://localhost/api/remote-clients/hub", {
    headers: { "x-metis-client-id": first.client.id, Authorization: `Bearer ${first.credential}` },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.client.id, first.client.id);
  assert.equal(body.audit.length, 1);
  assert.equal(body.audit[0].clientId, first.client.id);
  assert.equal(body.clients, undefined);
});

for (const permissionMode of ["user", "admin"] as const) {
  for (const mode of ["restricted", "approval_required", "full_access"] as const) {
    for (const action of ["write_file", "edit_file", "delete_file", "execute_command", "pty_open"] as const) {
      test(`approval matrix: ${permissionMode}/${mode}/${action}`, async () => {
        const { createUser } = await import("../lib/auth");
        const clients = await import("../lib/remote-clients");
        const owner = createUser("matrix-" + randomUUID(), "test-password");
        const client = clients.registerRemoteClient(
          clients.createEnrollmentToken(owner.id, undefined, permissionMode).token,
          { permissionMode },
        )!.client!;
        client.policy = { mode, permissions: [...clients.REMOTE_PERMISSIONS], allowlist: ["whoami"] };
        const result = clients.authorizeRemoteAction(client, action, { path: "notes.txt", command: "whoami" });
        const allowed = action !== "pty_open" || permissionMode === "admin";
        assert.equal(result.allowed, allowed);
        assert.equal(result.requiresApproval, allowed && (mode === "approval_required" || (mode === "restricted" && permissionMode === "admin")));
        if (action === "execute_command" && mode !== "full_access") {
          assert.equal(clients.authorizeRemoteAction(client, action, { command: "echo unlisted" }).allowed, false);
        }
      });
    }
  }
}

test("legacy file fallback preserves the approved operation and command policy", async (t) => {
  const { createUser } = await import("../lib/auth");
  const clients = await import("../lib/remote-clients");
  const gateway = await import("../lib/remote-client-gateway");
  const owner = createUser("legacy-" + randomUUID(), "test-password");
  const client = clients.registerRemoteClient(clients.createEnrollmentToken(owner.id).token, { name: "legacy-client" })!.client!;
  const sent: Array<{ action: string; params: Record<string, unknown> }> = [];
  let onNative: (() => void) | undefined;
  let nativeAction = "";
  const editResult = { path: "notes.txt", replacements: 1, changed: true };
  const socket = new EventEmitter() as EventEmitter & { readyState: number; send: (data: string) => void; close: () => void };
  socket.readyState = 1;
  socket.close = () => { socket.readyState = 3; socket.emit("close"); };
  socket.send = (data) => {
    const request = JSON.parse(data);
    if (request.type !== "request") return;
    sent.push(request);
    queueMicrotask(() => {
      if (request.action !== "execute_command") {
        nativeAction = request.action;
        onNative?.();
      }
      socket.emit("message", JSON.stringify({ type: "response", requestId: request.requestId,
        ok: request.action === "execute_command", error: "unsupported remote action", result: { stdout: nativeAction === "edit_file" ? JSON.stringify(editResult) : "legacy-ok" } }));
    });
  };
  gateway.attachRemoteClient(socket, client.id, owner.id);
  try {
    for (const action of ["write_file", "edit_file", "delete_file"] as const) {
      const params = { path: "notes.txt", content: "hello", oldText: "hello", newText: "world" };
      const input = { clientId: client.id, ownerId: owner.id, action, params };
      let command = "";
      await t.test(`${action}: full access fallback`, async () => {
        clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "full_access" } });
        sent.length = 0;
        assert.deepEqual(await gateway.requestRemoteClient(input), action === "edit_file" ? editResult : { stdout: "legacy-ok" });
        assert.deepEqual(sent.map((r) => r.action), [action, "execute_command"]);
        command = String(sent[1].params.command);
      });
      const approvedRequest = () => {
        const approval = clients.createRemoteApproval(input);
        assert.equal(clients.approveRemoteApproval(approval.id, owner.id), true);
        return gateway.requestRemoteClient({ ...input, approvalId: approval.id });
      };
      await t.test(`${action}: non-allowlisted command is denied after file approval`, async () => {
        clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "approval_required", allowlist: [] } });
        sent.length = 0;
        await assert.rejects(approvedRequest(), /allowlist/);
        assert.deepEqual(sent.map((r) => r.action), [action]);
      });
      await t.test(`${action}: exact allowlisted command uses the file approval once`, async () => {
        clients.updateRemoteClient(client.id, owner.id, { policy: { allowlist: [command] } });
        sent.length = 0;
        assert.deepEqual(await approvedRequest(), action === "edit_file" ? editResult : { stdout: "legacy-ok" });
        assert.deepEqual(sent.map((r) => r.action), [action, "execute_command"]);
        assert.equal(sent[1].params.command, command);
      });
      await t.test(`${action}: execute permission is required`, async () => {
        clients.updateRemoteClient(client.id, owner.id, { policy: { permissions: clients.REMOTE_PERMISSIONS.filter((p) => p !== "execute_command") } });
        sent.length = 0;
        await assert.rejects(approvedRequest(), /Permission execute_command/);
        assert.equal(sent.length, 1);
        clients.updateRemoteClient(client.id, owner.id, { policy: { permissions: [...clients.REMOTE_PERMISSIONS] } });
      });
    }
    await t.test("system paths never reach the legacy socket", async () => {
      clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "full_access" } });
      for (const file of ["Windows/system.ini", "/root/other-owner.txt", "/etc/passwd"]) {
        sent.length = 0;
        assert.throws(() => gateway.requestRemoteClient({ clientId: client.id, ownerId: owner.id, action: "write_file", params: { path: file } }), /User access/);
        assert.equal(sent.length, 0);
      }
    });
    await t.test("caller mutation cannot retarget an in-flight fallback", async () => {
      const params = { path: "approved.txt", content: "safe" };
      sent.length = 0;
      onNative = () => { params.path = "/root/other-owner.txt"; params.content = "changed"; };
      await gateway.requestRemoteClient({ clientId: client.id, ownerId: owner.id, action: "write_file", params });
      const decoded = [...String(sent[1].params.command).matchAll(/Buffer.from\('([^']*)','base64'\)/g)]
        .map((match) => Buffer.from(match[1], "base64").toString("utf8"));
      assert.deepEqual(decoded, ["approved.txt", "safe"]);
      onNative = undefined;
    });
    await t.test("revocation between native action and fallback is enforced", async () => {
      sent.length = 0;
      onNative = () => { clients.revokeRemoteClient(client.id, owner.id); };
      await assert.rejects(gateway.requestRemoteClient({ clientId: client.id, ownerId: owner.id, action: "delete_file", params: { path: "notes.txt" } }), /not found|revoked/i);
      assert.equal(sent.length, 1);
    });
  } finally { socket.close(); }
});
