import { getAuthenticatedUserId } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { transaction } from "@/lib/sqlite";
import { getAttachmentMaxBytes } from "@/lib/attachment-settings";
import { DEFAULT_ATTACHMENT_MAX_BYTES, isAttachmentMaxBytes } from "@/lib/upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(ownerId: string) {
  return Response.json({
    maxBytes: getAttachmentMaxBytes(ownerId),
    defaultMaxBytes: DEFAULT_ATTACHMENT_MAX_BYTES,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return response(ownerId);
}

export async function PATCH(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!isAttachmentMaxBytes(body?.maxBytes)) {
    return Response.json({ error: "Choose a positive file size, or Unlimited (0)." }, { status: 400 });
  }
  transaction(() => {
    const settings = getGlobalModelSettings(ownerId);
    saveGlobalModelSettings({ ...settings, attachmentMaxBytes: body.maxBytes }, ownerId);
  });
  return response(ownerId);
}
