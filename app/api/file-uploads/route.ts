import { getAuthenticatedUserId } from "@/lib/auth";
import { createUpload } from "@/lib/file-upload-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const owner = await getAuthenticatedUserId(req);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    return Response.json(createUpload(owner, { name: typeof body.name === "string" ? body.name : "", mimeType: typeof body.mimeType === "string" ? body.mimeType : "", size: body.size }), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 }); }
}
