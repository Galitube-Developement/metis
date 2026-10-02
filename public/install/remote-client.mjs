#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const configPath = value("--config") || process.env.METIS_REMOTE_CLIENT_CONFIG ||
  path.join(os.homedir(), ".metis-ai", "remote-client.json");
const configText = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "").replace(/^\u00EF\u00BB\u00BF/, "");
const config = JSON.parse(configText);
const logFile = path.join(path.dirname(configPath), "client.log");
const log = (...items) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${items.join(" ")}\n`); } catch {} };
process.on("uncaughtException", (error) => { log("uncaughtException", error?.stack || error); process.exit(1); });
process.on("unhandledRejection", (error) => log("unhandledRejection", error?.stack || error));
const server = String(config.server).replace(/\/+$/, "");
const wsUrl = server.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/ws/remote-client";
const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
const running = new Map();

async function execute(action, params = {}) {
  if (action === "get_info") {
    return {
      hostname: os.hostname(),
      os: `${process.platform} ${os.release()}`,
      architecture: process.arch,
      version: "1.0.0",
      cwd: process.cwd(),
      memory: { total: os.totalmem(), free: os.freemem() },
      uptime: os.uptime(),
    };
  }
  if (action === "execute_command") {
    const command = String(params.command || "");
    if (!command.trim()) throw new Error("Command is required");
    const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : os.homedir();
    const timeout = Math.max(1_000, Math.min(Number(params.timeout) || 60_000, 300_000));
    const result = await execFileAsync(shell, process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command], {
      cwd,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  }
  if (action === "list_directory") {
    const directory = String(params.path || os.homedir());
    return { path: directory, entries: fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })) };
  }
  if (action === "read_file") {
    const file = String(params.path || "");
    if (!file) throw new Error("Path is required");
    const limit = Math.min(Number(params.limit) || 5_000_000, 10_000_000);
    return { path: file, content: fs.readFileSync(file, "utf8").slice(0, limit) };
  }
  if (action === "write_file") {
    const file = String(params.path || "");
    if (!file) throw new Error("Path is required");
    if (typeof params.content !== "string") throw new Error("Content is required");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, params.content, "utf8");
    return { path: file, bytes: Buffer.byteLength(params.content, "utf8") };
  }
  if (action === "edit_file") {
    const file = String(params.path || "");
    const oldText = String(params.oldText ?? "");
    const newText = String(params.newText ?? "");
    if (!file) throw new Error("Path is required");
    const content = fs.readFileSync(file, "utf8");
    const position = content.indexOf(oldText);
    if (position < 0) throw new Error("The requested oldText was not found in the file");
    const next = `${content.slice(0, position)}${newText}${content.slice(position + oldText.length)}`;
    fs.writeFileSync(file, next, "utf8");
    return { path: file, replacements: 1, bytes: Buffer.byteLength(next, "utf8") };
  }
  if (action === "delete_file") {
    const file = String(params.path || "");
    if (!file) throw new Error("Path is required");
    fs.rmSync(file, { force: false });
    return { path: file, deleted: true };
  }
  if (action === "pty_open") {
    const child = spawn(shell, process.platform === "win32" ? [] : ["-i"], {
      cwd: typeof params.cwd === "string" ? params.cwd : os.homedir(),
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    });
    const sessionId = crypto.randomUUID();
    running.set(sessionId, child);
    child.stdout.on("data", (data) => send({ type: "event", sessionId, event: "stdout", data: data.toString() }));
    child.stderr.on("data", (data) => send({ type: "event", sessionId, event: "stderr", data: data.toString() }));
    child.on("exit", (code) => {
      running.delete(sessionId);
      send({ type: "event", sessionId, event: "exit", code });
    });
    return { sessionId };
  }
  if (action === "pty_input") {
    const child = running.get(String(params.sessionId));
    if (!child?.stdin.writable) throw new Error("PTY session not found");
    child.stdin.write(String(params.data || ""));
    return { ok: true };
  }
  if (action === "pty_close") {
    const child = running.get(String(params.sessionId));
    child?.kill();
    return { ok: true };
  }
  throw new Error(`Unsupported remote action: ${action}`);
}

let socket;
let reconnectTimer;
let heartbeatTimer;
let lastHeartbeatAckAt = 0;
let reconnectAttempt = 0;
let stopping = false;
function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
function scheduleReconnect() {
  if (stopping || reconnectTimer) return;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt++, 5));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
}
function connect() {
  if (stopping || socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) return;
  const currentSocket = new WebSocket(wsUrl);
  socket = currentSocket;
  currentSocket.on("open", () => {
    if (socket !== currentSocket) return;
    log("connected", wsUrl);
    send({ type: "auth", clientId: config.clientId, credential: config.credential });
  });
  currentSocket.on("message", async (raw) => {
    if (socket !== currentSocket) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === "authenticated") {
      reconnectAttempt = 0;
      log("authenticated", message.clientId || "");
      lastHeartbeatAckAt = Date.now();
      clearInterval(heartbeatTimer);
      send({ type: "heartbeat" });
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastHeartbeatAckAt > 60_000) {
          log("heartbeat timeout; reconnecting");
          currentSocket.close();
          return;
        }
        send({ type: "heartbeat" });
      }, 20_000);
      return;
    }
    if (message.type === "heartbeat_ack") {
      lastHeartbeatAckAt = Date.now();
      return;
    }
    if (message.type !== "request" || typeof message.requestId !== "string") return;
    try {
      const result = await execute(message.action, message.params);
      if (socket === currentSocket) send({ type: "response", requestId: message.requestId, ok: true, result });
    } catch (error) {
      if (socket === currentSocket) send({ type: "response", requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "Action failed" });
    }
  });
  currentSocket.on("close", (code, reason) => {
    log("closed", code, reason?.toString?.() || "");
    if (socket !== currentSocket) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    socket = undefined;
    scheduleReconnect();
  });
  currentSocket.on("error", (error) => { log("socket error", error?.message || error); currentSocket.close(); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function shutdown() {
  stopping = true;
  clearTimeout(reconnectTimer);
  clearInterval(heartbeatTimer);
  for (const child of running.values()) child.kill();
  socket?.close();
}
connect();

