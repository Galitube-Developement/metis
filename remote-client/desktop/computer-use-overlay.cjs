const OVERLAY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .edge { position: fixed; inset: 0; border: 2px solid rgba(255,255,255,.95); box-shadow: inset 0 0 12px 4px rgba(255,255,255,.9), inset 0 0 36px 10px rgba(255,255,255,.42); pointer-events: none; }
  .notice { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px); padding: 11px 17px; border: 1px solid rgba(255,255,255,.8); border-radius: 12px; background: rgba(22,25,30,.94); color: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.3), 0 0 18px rgba(255,255,255,.32); font-size: 13px; font-weight: 600; line-height: 1.35; white-space: nowrap; pointer-events: none; }
  .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #fff; box-shadow: 0 0 10px #fff; }
  @media (max-width: 480px) { .notice { top: 12px; white-space: normal; } }
</style>
</head>
<body><div class="edge"></div><div class="notice"><span class="dot"></span><span>Metis is using your computer · Press Escape to cancel</span></div></body>
</html>`;

const IDLE_MS = 45_000;

function createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, onCancel }) {
  const windows = new Map();
  let active = false;
  let suspended = false;
  let timer;
  let escapeRegistered = false;
  let suppressEscapeUntil = 0;

  function createWindow(display) {
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      show: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setContentProtection(true);
    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
    overlay.webContents.on("did-finish-load", () => {
      if (active && !suspended && !overlay.isDestroyed()) overlay.showInactive();
    });
    overlay.on("closed", () => windows.delete(display.id));
    return overlay;
  }

  function sync() {
    if (!active) return;
    const displays = screen.getAllDisplays();
    const ids = new Set(displays.map((display) => display.id));
    for (const [id, overlay] of windows) {
      if (!ids.has(id)) {
        windows.delete(id);
        if (!overlay.isDestroyed()) overlay.destroy();
      }
    }
    for (const display of displays) {
      let overlay = windows.get(display.id);
      if (!overlay || overlay.isDestroyed()) {
        overlay = createWindow(display);
        windows.set(display.id, overlay);
      } else {
        overlay.setBounds(display.bounds);
      }
      if (overlay.webContents.isLoading()) continue;
      if (suspended) overlay.hide();
      else overlay.showInactive();
    }
  }

  function hide() {
    active = false;
    suspended = false;
    clearTimeout(timer);
    if (escapeRegistered) globalShortcut.unregister("Escape");
    escapeRegistered = false;
    for (const overlay of windows.values()) {
      if (!overlay.isDestroyed()) overlay.hide();
    }
  }

  function touch() {
    active = true;
    clearTimeout(timer);
    timer = setTimeout(hide, IDLE_MS);
    timer.unref?.();
    if (!escapeRegistered) {
      escapeRegistered = globalShortcut.register("Escape", () => {
        if (Date.now() < suppressEscapeUntil) return;
        hide();
        onCancel();
      });
    }
    sync();
  }

  function suspendCapture() {
    if (!active) return;
    suspended = true;
    for (const overlay of windows.values()) {
      if (!overlay.isDestroyed()) overlay.hide();
    }
  }

  function resumeCapture() {
    if (!active) return;
    suspended = false;
    sync();
  }

  function suppressInjectedEscape() {
    suppressEscapeUntil = Date.now() + 1000;
  }

  screen.on("display-added", sync);
  screen.on("display-removed", sync);
  screen.on("display-metrics-changed", sync);

  return { touch, hide, suspendCapture, resumeCapture, suppressInjectedEscape };
}

module.exports = { createComputerUseOverlay };
