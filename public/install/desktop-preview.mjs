import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { windowsDesktopPreviewScript } from "./desktop-preview-command.mjs";
export { windowsDesktopPreviewScript, windowsDesktopPreviewCommand } from "./desktop-preview-command.mjs";
const exec = promisify(execFile);

export async function captureDesktopPreview({ signal, platform = process.platform, run = exec, env = process.env } = {}) {
  const options = { signal, env, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 };
  if (platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(windowsDesktopPreviewScript, "utf16le").toString("base64")], options);
    return JSON.parse(String(result.stdout).trim());
  }
  if (platform === "darwin") {
    // The existing helper checks Screen Recording and the session lock without raising a window.
    const { unixComputerUse } = await import("./computer-use-unix.mjs");
    const state = await unixComputerUse({ operation: "status" }, { signal, platform, env, run });
    if (!state.available) throw new Error(state.reason || "Desktop capture is unavailable");
    const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-preview-"));
    try {
      const file = path.join(dir, "screen.jpg");
      await run("/usr/sbin/screencapture", ["-x", "-m", "-t", "jpg", file], options);
      return { image_base64: (await fs.readFile(file)).toString("base64"), mimeType: "image/jpeg" };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  if (platform === "linux") {
    const { unixComputerUse } = await import("./computer-use-unix.mjs");
    const state = await unixComputerUse({ operation: "status" }, { signal, platform, env, run });
    if (!state.available) throw new Error(state.reason || "Desktop capture is unavailable");
    const result = await run("import", ["-window", "root", "-resize", "1600x1600>", "jpeg:-"],
      { ...options, encoding: "buffer" });
    return { image_base64: Buffer.from(result.stdout).toString("base64"), mimeType: "image/jpeg" };
  }
  throw new Error("Desktop preview is unavailable on this operating system");
}
