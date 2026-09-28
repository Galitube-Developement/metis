import assert from "node:assert/strict";
import test from "node:test";
import {
  selectWindowsClient,
  windowsClientCommand,
  windowsClientJobResult,
  windowsScreenshotScript,
} from "../lib/mcp-core/windows-client-bridge.mjs";

test("selectWindowsClient selects one online Windows device and rejects ambiguity", () => {
  const windows = { id: "win-1", os: "windows 10.0", status: "online" };
  const clients = [windows, { id: "linux-1", os: "linux", status: "online" }];
  assert.equal(selectWindowsClient(clients).id, "win-1");
  assert.throws(() => selectWindowsClient(clients, "linux-1"), /not online/);
  assert.throws(() => selectWindowsClient([...clients, { id: "win-2", os: "Windows 11", status: "online" }]), /More than one/);
  assert.throws(() => selectWindowsClient([], undefined), /No Windows client/);
});

test("Windows desktop command preserves argument boundaries and rejects unsafe environment keys", () => {
  const command = windowsClientCommand({
    action: "run",
    command: ["winapp", "ui", "search", "A file with spaces"],
    env: { WINAPP_CLI_TELEMETRY_OPTOUT: "1" },
  });
  const encoded = command.split(" ").at(-1);
  const script = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(script, /& 'winapp' 'ui' 'search' 'A file with spaces'/);
  assert.match(script, /\$env:WINAPP_CLI_TELEMETRY_OPTOUT='1'/);
  assert.throws(() => windowsClientCommand({ command: "echo safe", env: { "X;Remove-Item": "1" } }), /Invalid environment/);
});

test("Windows desktop spawn and screenshot scripts have the expected output contract", () => {
  const spawn = windowsClientCommand({ action: "spawn", command: "npm start" });
  const spawnScript = Buffer.from(spawn.split(" ").at(-1), "base64").toString("utf16le");
  assert.match(spawnScript, /Start-Process/);
  assert.deepEqual(windowsClientJobResult({ action: "spawn" }, { stdout: "4312\r\n" }), {
    ok: true, action: "spawn", pid: 4312,
  });
  const screenshot = windowsScreenshotScript(["winapp", "ui", "screenshot", "window", "--json"]);
  assert.match(screenshot, /ConvertFrom-Json/);
  assert.match(screenshot, /image_base64/);
});
