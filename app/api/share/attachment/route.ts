import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { getChatByShareId } from "@/lib/db-store";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function attachmentResponse(req: Request, body?: { id?: string; name?: string; password?: string }) {
  const url = new URL(req.url);
  const id = body?.id || url.searchParams.get("id") || "";
  const name = body?.name || url.searchParams.get("name") || "";
  const password = body?.password;
  const result = getChatByShareId(id, password);
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Password required" }, { status: 401 });
  }
  const attachment = result.chat.messages
    .flatMap((message) => message.attachments || [])
    .find((item) => item.storedName === name);
  if (!attachment?.storedName) return Response.json({ error: "Attachment not found" }, { status: 404 });
  const file = resolveUploadPath(result.chat.id, attachment.storedName, result.ownerId);
  if (!file) return Response.json({ error: "Attachment not found" }, { status: 404 });
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": attachment.kind === "image" ? attachment.mimeType : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(statSync(file).size),
      "Content-Disposition": `${attachment.kind === "image" ? "inline" : "attachment"}; filename="${encodeURIComponent(attachment.name)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function GET(req: Request) {
  return attachmentResponse(req);
}

export async function POST(req: Request) {
  let body: { id?: string; name?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; name?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return attachmentResponse(req, body);
}
