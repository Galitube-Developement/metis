import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Persist captures within the resolved account workspace, never a global public directory. */
export async function saveScreenshot({ data, mimeType, workspace, chatId, share = false, provideFile }) {
  if (!workspace) throw new Error("Screenshot storage requires an account workspace");
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : null;
  if (!extension) throw new Error("Unsupported screenshot format");
  const bytes = Buffer.from(String(data || ""), "base64");
  if (!bytes.length) throw new Error("Screenshot returned no image data");
  const scope = createHash("sha256").update(String(chatId || "browser")).digest("hex").slice(0, 24);
  const directory = path.join(workspace, ".metis", "screenshots", scope);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `screenshot-${Date.now()}-${randomUUID()}.${extension}`;
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
  const result = { path: filePath, mimeType, size: bytes.length };
  if (share) {
    try {
      Object.assign(result, await provideFile({ path: filePath, name, mimeType }));
    } catch (error) {
      // Preserve the capture for inspection/retry even if attachment creation fails.
      result.shareError = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}
