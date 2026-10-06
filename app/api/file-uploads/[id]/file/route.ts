import { getAuthenticatedUserId } from "@/lib/auth";
import { uploadedFileResponse } from "@/lib/file-upload-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await getAuthenticatedUserId(req);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return uploadedFileResponse(owner, (await params).id, req); }
  catch { return Response.json({ error: "File not found" }, { status: 404 }); }
}
