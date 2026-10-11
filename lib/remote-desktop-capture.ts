import sharp from "sharp";
import { windowsDesktopPreviewCommand } from "@/remote-client/desktop-preview.mjs";
import { authorizeRemoteAction, getRemoteClient } from "@/lib/remote-clients";
import { requestRemoteClient } from "@/lib/remote-client-gateway";

type CaptureRequest = typeof requestRemoteClient;
type Frame = { data: Uint8Array; capturedAt: number; width: number; height: number };
export class DesktopPreviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Share one capture between viewers; never queue frames behind a slow device. */
export function createDesktopCapture(request: CaptureRequest = requestRemoteClient) {
  const pending = new Map<string, Promise<Frame>>();
  const legacyUntil = new Map<string, number>();
  return async (clientId: string, ownerId: string): Promise<Frame> => {
    const client = getRemoteClient(clientId, ownerId);
    if (!client) throw new DesktopPreviewError("Remote client not found", 404);
    if (client.status !== "online") throw new DesktopPreviewError("This device is offline. Start its Remote Client to view the desktop.", 409);
    const access = authorizeRemoteAction(client, "computer_use", { operation: "preview" });
    if (!access.allowed) throw new DesktopPreviewError(access.reason || "Desktop access is disabled", 403);
    const key = ownerId + ":" + clientId;
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 32) throw new DesktopPreviewError("Too many desktop previews. Try again shortly.", 429);
    const capture = async () => {
      const nativeKey = key + ":" + (client.version || "");
      let result: unknown;
      const native = async () => request({ clientId, ownerId, action: "computer_use",
        params: { operation: "preview" }, source: "user", ephemeralPreview: true, timeoutMs: 15_000 });
      if ((legacyUntil.get(nativeKey) || 0) < Date.now()) {
        try { result = await native(); }
        catch (error) {
          if (!(error instanceof Error) || !/unsupported computer use operation/i.test(error.message)) throw error;
          if (legacyUntil.size >= 200) legacyUntil.delete(legacyUntil.keys().next().value!);
          legacyUntil.set(nativeKey, Date.now() + 180_000);
        }
      }
      if (!result) {
        // Existing Windows clients support the fixed passive command. Their
        // original command permission, allowlist and approval rules still apply.
        const command = windowsDesktopPreviewCommand();
        const access = authorizeRemoteAction(client, "execute_command", { command });
        if (!/windows/i.test(client.os || "") || !access.allowed || access.requiresApproval) {
          throw new DesktopPreviewError("Update this Remote Client to enable passive desktop preview. Its current permissions do not allow the compatible capture.", 409);
        }
        const legacy = await request({ clientId, ownerId, action: "execute_command",
          params: { command, timeout: 15_000 }, source: "user", ephemeralPreview: true, timeoutMs: 20_000 }) as { stdout?: string };
        try { result = JSON.parse(legacy.stdout || ""); }
        catch { throw new DesktopPreviewError("The device returned an invalid desktop frame"); }
      }
      const image = result as { image_base64?: unknown; mimeType?: unknown };
      if (typeof image.image_base64 !== "string" || image.image_base64.length > 12 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(image.image_base64)) throw new DesktopPreviewError("The device returned an invalid desktop frame");
      const buffer = Buffer.from(image.image_base64, "base64");
      const { data, info } = await sharp(buffer, { limitInputPixels: 64_000_000 })
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 }).toBuffer({ resolveWithObject: true });
      return { data: new Uint8Array(data), capturedAt: Date.now(), width: info.width, height: info.height };
    };
    const promise = capture();
    pending.set(key, promise);
    try { return await promise; }
    finally {
      // Bound the frame lifetime and capture rate, including failed captures.
      const timer = setTimeout(() => { if (pending.get(key) === promise) pending.delete(key); }, 500);
      timer.unref?.();
    }
  };
}
const globals = globalThis as typeof globalThis & { __metisDesktopCapture?: ReturnType<typeof createDesktopCapture> };
export const captureRemoteDesktop = globals.__metisDesktopCapture ??= createDesktopCapture();
