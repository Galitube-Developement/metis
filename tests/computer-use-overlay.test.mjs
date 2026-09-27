import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import overlayPackage from "../remote-client/desktop/computer-use-overlay.cjs";

const { createComputerUseOverlay } = overlayPackage;

test("computer-use overlay covers every display and stays out of captures", () => {
  const displays = [
    { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    { id: 2, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  ];
  const screen = new EventEmitter();
  screen.getAllDisplays = () => displays;
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.isLoading = () => false;
      windows.push(this);
    }
    setAlwaysOnTop(value, level) { this.level = value && level; }
    setIgnoreMouseEvents(value) { this.ignoreMouse = value; }
    setContentProtection(value) { this.protected = value; }
    loadURL(url) { this.url = url; }
    setBounds(bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isDestroyed() { return this.destroyed; }
    on() {}
  }
  let escape;
  let cancelled = 0;
  const globalShortcut = {
    register(key, callback) { assert.equal(key, "Escape"); escape = callback; return true; },
    unregister(key) { assert.equal(key, "Escape"); escape = undefined; },
  };
  const overlay = createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, onCancel: () => { cancelled++; } });

  overlay.touch();
  assert.equal(windows.length, 2);
  for (const item of windows) {
    assert.equal(item.visible, true);
    assert.equal(item.protected, true);
    assert.equal(item.ignoreMouse, true);
    assert.equal(item.level, "screen-saver");
    assert.match(decodeURIComponent(item.url), /Press Escape to cancel/);
  }
  assert.deepEqual(windows.map((item) => item.options.x), [-1920, 0]);
  overlay.suspendCapture();
  assert.ok(windows.every((item) => !item.visible));
  overlay.resumeCapture();
  assert.ok(windows.every((item) => item.visible));

  escape();
  assert.equal(cancelled, 1);
  assert.ok(windows.every((item) => !item.visible));
  assert.equal(escape, undefined);
  overlay.resumeCapture();
  assert.ok(windows.every((item) => !item.visible));
});
