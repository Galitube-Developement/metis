import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const helper = process.env.METIS_DESKTOP_HELPER || fileURLToPath(new URL("./metis-desktop-helper", import.meta.url));
const options = { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 };
const keys = { ctrl: "ctrl", control: "ctrl", shift: "shift", alt: "alt", meta: "super", super: "super",
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", tab: "Tab", backspace: "BackSpace",
  delete: "Delete", space: "space", up: "Up", down: "Down", left: "Left", right: "Right", home: "Home",
  end: "End", pageup: "Prior", pagedown: "Next", insert: "Insert" };

export async function unixComputerUse(payload, { signal, platform = process.platform, env = process.env, run = exec } = {}) {
  const call = async (command, args) => {
    const result = await run(command, args, { ...options, signal, env, encoding: "utf8" });
    return result.stdout.trim();
  };
  if (platform === "darwin") {
    const result = JSON.parse(await call(helper, [Buffer.from(JSON.stringify(payload)).toString("base64")]));
    if (payload.operation !== "observe") return result;
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "metis-observe-"));
    try {
      const file = path.join(temporary, "screen.png");
      await call("/usr/sbin/screencapture", ["-x", "-R", [result.x, result.y, result.width, result.height].join(","), file]);
      const png = await fs.readFile(file);
      // Retina screenshots are pixels; input coordinates are logical points.
      return { ...result, png: png.toString("base64"), width: png.readUInt32BE(16), height: png.readUInt32BE(20),
        coordinateWidth: result.width, coordinateHeight: result.height };
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }
  if (platform !== "linux") throw new Error("Computer Use supports Windows, macOS and Linux X11");
  const reason = env.XDG_SESSION_TYPE === "wayland" || env.WAYLAND_DISPLAY
    ? "Wayland desktop control is unavailable. Sign in with an X11 session."
    : !env.DISPLAY ? "No interactive X11 display is available" : null;
  if (reason) {
    if (payload.operation === "status") return { available: false, reason };
    throw new Error(reason);
  }
  try {
    await call("xdotool", ["getdisplaygeometry"]);
    await call("wmctrl", ["-m"]);
    await call("import", ["-version"]);
  } catch {
    const reason = "Linux X11 desktop control needs xdotool, wmctrl and ImageMagick (import). Install these with your distribution package manager.";
    if (payload.operation === "status") return { available: false, reason };
    throw new Error(reason);
  }
  // Check the screen lock where supported; a locked session must never receive input.
  for (const [service, object] of [["org.gnome.ScreenSaver", "/org/gnome/ScreenSaver"],
    ["org.freedesktop.ScreenSaver", "/ScreenSaver"]]) {
    let active = "";
    try { active = await call("gdbus", ["call", "--session", "--dest", service, "--object-path", object,
      "--method", service + ".GetActive"]); } catch (error) { if (signal?.aborted) throw error; }
    if (/\btrue\b/.test(active)) {
      if (payload.operation === "status") return { available: false, reason: "Desktop is locked" };
      throw new Error("Desktop is locked");
    }
  }
  if (payload.operation === "status") return { available: true, backend: "x11" };
  const raw = await call("wmctrl", ["-lG"]);
  const windows = raw.split("\n").flatMap(line => {
    const match = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s*(.*)$/i);
    return match && Number(match[5]) > 0 && Number(match[6]) > 0
      ? [{ id: String(parseInt(match[1], 16)), title: match[7], x: Number(match[3]), y: Number(match[4]),
        width: Number(match[5]), height: Number(match[6]) }] : [];
  });
  if (payload.operation === "list_windows") return { windows };
  const window = windows.find(item => item.id === payload.windowId);
  if (!window) throw new Error("Target window is unavailable");
  const id = "0x" + BigInt(window.id).toString(16);
  await call("wmctrl", ["-ia", id]);
  await call("xdotool", ["windowfocus", "--sync", window.id]);
  if (await call("xdotool", ["getactivewindow"]) !== window.id) throw new Error("Could not activate target window");
  const geometry = await call("xdotool", ["getwindowgeometry", "--shell", window.id]);
  const fields = Object.fromEntries(geometry.split("\n").map(line => line.split("=")));
  Object.assign(window, { x: Number(fields.X), y: Number(fields.Y), width: Number(fields.WIDTH), height: Number(fields.HEIGHT) });
  if (![window.x, window.y, window.width, window.height].every(Number.isFinite) || window.width < 1 ||
      window.height < 1 || window.width > 8000 || window.height > 8000) throw new Error("Invalid window geometry");
  if (payload.operation === "observe") {
    const result = await run("import", ["-window", "root", "-crop",
      window.width + "x" + window.height + (window.x < 0 ? "" : "+") + window.x + (window.y < 0 ? "" : "+") + window.y,
      "png:-"], { ...options, signal, env, encoding: "buffer" });
    const png = Buffer.from(result.stdout);
    return { ...window, windowId: window.id, png: png.toString("base64") };
  }
  if (payload.expectedGeometry && ["x", "y", "width", "height"].some(key => window[key] !== payload.expectedGeometry[key]))
    throw new Error("Window moved or resized. Observe this window again before acting");
  const position = (x, y) => {
    if (x < 0 || y < 0 || x >= window.width || y >= window.height) throw new Error("Coordinates are outside the target window");
    return ["mousemove", "--sync", String(window.x + x), String(window.y + y)];
  };
  if (payload.operation === "move") await call("xdotool", position(payload.x, payload.y));
  else if (payload.operation === "click") await call("xdotool", [...position(payload.x, payload.y), "click", "--repeat",
    String(payload.count), "--delay", "80", String({ left: 1, middle: 2, right: 3 }[payload.button])]);
  else if (payload.operation === "scroll") {
    if (payload.deltaY) await call("xdotool", [...position(payload.x, payload.y), "click", "--repeat",
      String(Math.ceil(Math.abs(payload.deltaY) / 120)), String(payload.deltaY > 0 ? 4 : 5)]);
  } else if (payload.operation === "drag") {
    // Validate both ends before pressing the button; always release on cancellation.
    const start = position(payload.x, payload.y), end = position(payload.toX, payload.toY);
    try {
      await call("xdotool", [...start, "mousedown", "1"]);
      for (let step = 1; step <= 12; step++) {
        await call("xdotool", position(Math.round(payload.x + (payload.toX - payload.x) * step / 12),
          Math.round(payload.y + (payload.toY - payload.y) * step / 12)));
      }
    } finally { await run("xdotool", ["mouseup", "1"], { ...options, env, encoding: "utf8" }); }
  } else if (payload.operation === "type") await call("xdotool", ["type", "--clearmodifiers", "--", payload.text]);
  else if (payload.operation === "key") {
    const chord = payload.key.toLowerCase().split("+").map(key => {
      const value = key.trim();
      if (keys[value]) return keys[value];
      if (/^[a-z0-9]$/.test(value) || /^f([1-9]|1[0-2])$/.test(value)) return value;
      throw new Error("Unsupported key: " + value);
    }).join("+");
    await call("xdotool", ["key", "--clearmodifiers", chord]);
  } else throw new Error("Unsupported computer use operation");
  return { ok: true, windowId: window.id };
}
