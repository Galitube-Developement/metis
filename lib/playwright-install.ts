import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let installPromise: Promise<void> | null = null;

export function isPlaywrightBrowserMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|browserType\.launch|playwright chromium is not installed/i.test(message);
}

export async function installPlaywrightChromium() {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const cli = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
    await execFileAsync(process.execPath, [cli, "install", "chromium"], {
      cwd: process.cwd(),
      maxBuffer: 2 * 1024 * 1024,
    });
  })();
  try {
    await installPromise;
  } finally {
    installPromise = null;
  }
}
