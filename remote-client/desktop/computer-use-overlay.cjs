const OVERLAY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .notice { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; max-width: calc(100vw - 32px); padding: 9px 13px; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: rgba(24,25,27,.9); color: #f4f4f5; box-shadow: 0 3px 12px rgba(0,0,0,.2); font-size: 12px; font-weight: 500; line-height: 1.35; white-space: nowrap; pointer-events: none; }
  .dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #80d6ad; }
  .cursor { position: fixed; z-index: 2; left: 0; top: 0; width: 25px; height: 31px; opacity: 0; transform: translate(-2px,-2px); transition: opacity 100ms ease; filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); pointer-events: none; }
  .cursor.visible { opacity: 1; }
  @media (max-width: 480px) { .notice { top: 12px; white-space: normal; } }
</style>
</head>
<body><div class="notice"><span>Metis is controlling this PC <span style="opacity:.62">· Esc to stop</span></span></div><svg class="cursor" aria-hidden="true" viewBox="0 0 25 31"><path d="M2 1.5v23l6.2-6 4.1 10 4.1-1.7-4.1-9.8h8.2L2 1.5Z" fill="#fff" stroke="#17191c" stroke-width="1.8" stroke-linejoin="round"/></svg><script>const cursor=document.querySelector(".cursor");window.metisCursor=(x,y,visible)=>{cursor.style.left=x+"px";cursor.style.top=y+"px";cursor.classList.toggle("visible",visible)};</script></body>
</html>`;

const IDLE_MS = 45_000;

function createComputerUseOverlay({ BrowserWindow, screen, globalShortcut, onCancel }) {
  const windows = new Map();
  let active = false;
  let suspended = false;
  let timer;
  let cursorHideTimer;
  let cursorDisplayId = null;
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

  function updateCursor(x, y) {
    if (!active || suspended || !Number.isFinite(x) || !Number.isFinite(y)) return;
    clearTimeout(cursorHideTimer);
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
    if (!display) return;
    const overlay = windows.get(display.id);
    if (!overlay || overlay.isDestroyed() || overlay.webContents.isLoading()) return;
    const localX = x - display.bounds.x;
    const localY = y - display.bounds.y;
    overlay.webContents.executeJavaScript(`window.metisCursor?.(${localX},${localY},true)`).catch(() => {});
  }

  function hideCursor(delay = 0) {
    clearTimeout(cursorHideTimer);
    cursorHideTimer = setTimeout(() => {
      if (cursorDisplayId !== null) {
        const overlay = windows.get(cursorDisplayId);
        if (overlay && !overlay.isDestroyed()) overlay.webContents.executeJavaScript("window.metisCursor?.(0,0,false)").catch(() => {});
      }
      cursorDisplayId = null;
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
