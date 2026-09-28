const OVERLAY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body::before { content: ""; position: fixed; z-index: 3; inset: 0; border: 2px solid rgba(255,255,255,.96); box-shadow: inset 0 0 14px rgba(255,255,255,.9), inset 0 0 38px rgba(255,255,255,.38); pointer-events: none; }
  .notice { position: fixed; z-index: 4; top: 18px; left: 50%; transform: translateX(-50%); display: flex; align-items: baseline; gap: 7px; max-width: calc(100vw - 32px); padding: 9px 13px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: rgba(24,25,27,.92); color: #f4f4f5; box-shadow: 0 3px 12px rgba(0,0,0,.24); font-size: 12px; font-weight: 600; line-height: 1.35; white-space: nowrap; pointer-events: none; }
  .notice span { color: rgba(244,244,245,.68); font-weight: 500; }
  .cursor { position: fixed; z-index: 5; left: 0; top: 0; width: 18px; height: 24px; opacity: 0; transform: translate(-12%,-10%); transition: opacity 100ms ease; filter: drop-shadow(0 2px 2px rgba(0,0,0,.48)) drop-shadow(0 0 5px rgba(215,244,252,.3)); pointer-events: none; }
  .cursor.visible { opacity: 1; }
  @media (max-width: 480px) { .notice { top: 12px; display: block; text-align: center; white-space: normal; } .notice span { display: block; margin-top: 2px; } }
</style>
</head>
<body><div class="notice">Metis is using your computer <span>Press Escape to cancel</span></div><svg class="cursor" aria-hidden="true" viewBox="0 0 52 48"><defs><linearGradient id="metis-browser-cursor-glass" x1="7" y1="4" x2="39" y2="42" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="rgba(42,55,63,0.72)"/><stop offset=".44" stop-color="rgba(18,28,34,0.54)"/><stop offset="1" stop-color="rgba(6,11,15,0.34)"/></linearGradient><linearGradient id="metis-browser-cursor-edge" x1="3" y1="4" x2="40" y2="43" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="rgba(255,255,255,0.96)"/><stop offset=".34" stop-color="rgba(191,232,241,.78)"/><stop offset=".7" stop-color="rgba(117,166,180,.58)"/><stop offset="1" stop-color="rgba(238,247,250,.84)"/></linearGradient><radialGradient id="metis-browser-cursor-glow" cx="0" cy="0" r="1" gradientTransform="translate(15 12) rotate(34) scale(31 24)" gradientUnits="userSpaceOnUse"><stop stop-color="rgba(224,248,255,.3)"/><stop offset="1" stop-color="rgba(224,248,255,0)"/></radialGradient></defs><path d="M7.1 4.15C4.05 3.4 1.72 6.15 2.8 9.08l13.35 33.55c1.04 2.78 4.82 3.08 6.28.48l7.35-17.38c1.1-2.57 3.2-4.55 5.83-5.51l12.78-4.7c3.46-1.27 3.46-6.17-.03-7.39L7.1 4.15Z" fill="url(#metis-browser-cursor-glass)" stroke="url(#metis-browser-cursor-edge)" stroke-width="1.3" stroke-linejoin="round"/><path d="M7.35 5.8 18.02 40.9c.43 1.46 2.43 1.61 3.08.24l6.98-15.08c1.28-2.76 3.59-4.91 6.43-5.99l12.18-4.6" fill="none" stroke="rgba(238,252,255,.42)" stroke-width=".9" stroke-linecap="round"/><path d="M6.1 5.05 48.1 12.95 35.25 17.7 9.3 9.2Z" fill="url(#metis-browser-cursor-glow)"/></svg><script>const cursor=document.querySelector(".cursor");window.metisCursor=(x,y,visible)=>{cursor.style.left=x+"px";cursor.style.top=y+"px";cursor.classList.toggle("visible",visible)};</script></body>
</html>`;

const IDLE_MS = 45_000;

function createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, onCancel }) {
  const windows = new Map();
  let active = false;
  let suspended = false;
  let timer;
  let cursorHideTimer;
  let cursorDisplayId = null;
  let cursorPosition = null;
  let escapeRegistered = false;
  let suppressEscapeUntil = 0;

  function renderCursor(display, overlay) {
    if (!cursorPosition || cursorDisplayId !== display.id || suspended || overlay.isDestroyed() || overlay.webContents.isLoading()) return;
    const localX = cursorPosition.x - display.bounds.x;
    const localY = cursorPosition.y - display.bounds.y;
    overlay.webContents.executeJavaScript(`window.metisCursor?.(${localX},${localY},true)`).catch(() => {});
  }

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
      if (active && !suspended && !overlay.isDestroyed()) {
        overlay.showInactive();
        renderCursor(display, overlay);
      }
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

  function updateCursor(x, y) {
    if (!active || !Number.isFinite(x) || !Number.isFinite(y)) return;
    clearTimeout(cursorHideTimer);
    cursorPosition = { x, y };
    const display = screen.getAllDisplays().find((item) => {
      const b = item.bounds;
      return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;
    });
    const nextId = display?.id ?? null;
    if (cursorDisplayId !== null && cursorDisplayId !== nextId) {
      const previous = windows.get(cursorDisplayId);
      if (previous && !previous.isDestroyed()) previous.webContents.executeJavaScript("window.metisCursor?.(0,0,false)").catch(() => {});
    }
    cursorDisplayId = nextId;
    if (!display || suspended) return;
    const overlay = windows.get(display.id);
    if (!overlay) return;
    renderCursor(display, overlay);
  }

  function hideCursor(delay = 0) {
    clearTimeout(cursorHideTimer);
    cursorHideTimer = setTimeout(() => {
      if (cursorDisplayId !== null) {
        const overlay = windows.get(cursorDisplayId);
        if (overlay && !overlay.isDestroyed()) overlay.webContents.executeJavaScript("window.metisCursor?.(0,0,false)").catch(() => {});
      }
      cursorDisplayId = null;
      cursorPosition = null;
    }, delay);
  }

  function hide() {
    active = false;
    suspended = false;
    hideCursor();
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
    hideCursor();
    for (const overlay of windows.values()) {
      if (!overlay.isDestroyed()) overlay.hide();
    }
  }

  function resumeCapture() {
    if (!active) return;
    suspended = false;
    sync();
    if (cursorPosition) updateCursor(cursorPosition.x, cursorPosition.y);
  }

  function suppressInjectedEscape() {
    suppressEscapeUntil = Date.now() + 1000;
  }

  screen.on("display-added", sync);
  screen.on("display-removed", sync);
  screen.on("display-metrics-changed", sync);

  return { touch, hide, suspendCapture, resumeCapture, suppressInjectedEscape, updateCursor, hideCursor };
}

module.exports = { createComputerUseOverlay };
