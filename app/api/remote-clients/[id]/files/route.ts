import { getAuthenticatedUserId } from "@/lib/auth";
import { transferFileToDesktop } from "@/lib/remote-file-transfer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.uploadId !== "string") return Response.json({ error: "An uploadId is required" }, { status: 400 });
  try { return Response.json(await transferFileToDesktop(ownerId, (await params).id, body.uploadId)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "File transfer failed" }, { status: 400 }); }
}
