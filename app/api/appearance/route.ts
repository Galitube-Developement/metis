import { getAuthenticatedUserId } from "@/lib/auth";
import { getAppearanceSettings, saveAppearanceSettings } from "@/lib/appearance-settings";
import { MAX_APPEARANCE_STATE_BYTES, normalizeAppearanceState } from "@/lib/appearance-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const maxRequestBytes = MAX_APPEARANCE_STATE_BYTES + 1024;

class AppearanceRequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

async function readBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > maxRequestBytes) {
    throw new AppearanceRequestError("Appearance settings are too large.", 413);
  }
  const reader = req.body?.getReader();
  if (!reader) throw new AppearanceRequestError("Missing appearance settings.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppearanceRequestError("Appearance settings are too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new AppearanceRequestError("Invalid appearance settings JSON.");
  }
}

export async function GET(req: Request) {
  try {
    const ownerId = await getAuthenticatedUserId(req);
    if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    return Response.json(getAppearanceSettings(ownerId), { headers });
  } catch {
    return Response.json({ error: "Could not load appearance settings." }, { status: 500, headers });
  }
}

export async function PATCH(req: Request) {
  try {
    const ownerId = await getAuthenticatedUserId(req);
    if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppearanceRequestError("Appearance settings must be a JSON object.");
    }
    const input = body as Record<string, unknown>;
    if (typeof input.ownerId !== "string" || !input.ownerId) {
      throw new AppearanceRequestError("ownerId must identify the account that loaded these settings.");
    }
    if (input.ownerId !== ownerId) {
      return Response.json({
        ...getAppearanceSettings(ownerId),
        error: "Account changed. Load this account's appearance settings before saving.",
      }, { status: 409, headers });
    }
    if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0 ||
      Number(input.revision) >= Number.MAX_SAFE_INTEGER) {
      throw new AppearanceRequestError("revision must be a non-negative safe integer.");
    }
    let state: ReturnType<typeof normalizeAppearanceState>;
    try {
      state = normalizeAppearanceState(input.state);
    } catch (error) {
      throw new AppearanceRequestError(error instanceof Error ? error.message : "Invalid appearance settings.");
    }
    const result = saveAppearanceSettings(ownerId, state, input.revision as number);
    if (!result.ok) {
      return Response.json({
        ...result.record,
        error: "Appearance settings changed in another tab or device. Load the latest settings and try again.",
      }, { status: 409, headers });
    }
    return Response.json(result.record, { headers });
  } catch (error) {
    if (error instanceof AppearanceRequestError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "Could not save appearance settings." }, { status: 500, headers });
  }
}
