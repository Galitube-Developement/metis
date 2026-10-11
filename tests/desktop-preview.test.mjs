import assert from "node:assert/strict";
import test from "node:test";
import { captureDesktopPreview, windowsDesktopPreviewCommand, windowsDesktopPreviewScript } from "../remote-client/desktop-preview.mjs";

test("Windows preview uses a bounded passive image and detects locked desktops", async () => {
  let called = false;
  const result = await captureDesktopPreview({ platform: "win32", run: async (command, args, options) => {
    called = true; assert.equal(command, "powershell.exe"); assert.equal(options.timeout, 15000);
    const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
    assert.equal(script, windowsDesktopPreviewScript);
    assert.match(script, /Unlocked/); assert.match(script, /Min\(1600/);
    assert.ok(!/SetForegroundWindow|SetCursorPos|SendInput|ActivateWindow/.test(script));
    return { stdout: '{"image_base64":"fixture","mimeType":"image/jpeg"}' };
  } });
  assert.ok(called); assert.equal(result.mimeType, "image/jpeg");
  assert.match(windowsDesktopPreviewCommand(), /^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
});

test("Linux preview captures root without focus, keyboard or mouse commands", async () => {
  const calls = [];
  const result = await captureDesktopPreview({ platform: "linux", env: { DISPLAY: ":1" },
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === "gdbus") return { stdout: "(false,)" };
      if (command === "import" && args.includes("jpeg:-")) return { stdout: Buffer.from("fixture") };
      return { stdout: "test" };
    } });
  assert.equal(result.image_base64, Buffer.from("fixture").toString("base64"));
  assert.ok(calls.some(([command, args]) => command === "import" && args.includes("root")));
  assert.ok(!calls.some(([, args]) => args.some(arg => /windowfocus|mousemove|click|keydown/.test(arg))));
});

test("Linux preview refuses Wayland and locked sessions without capturing", async () => {
  const failIfCalled = async () => { throw new Error("unexpected capture"); };
  await assert.rejects(captureDesktopPreview({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" }, run: failIfCalled }), /Wayland/);
  const calls = [];
  await assert.rejects(captureDesktopPreview({ platform: "linux", env: { DISPLAY: ":1" },
    run: async (command, args) => { calls.push([command, args]); return { stdout: command === "gdbus" ? "(true,)" : "test" }; } }), /locked/);
  assert.ok(!calls.some(([, args]) => args.includes("jpeg:-")));
});
