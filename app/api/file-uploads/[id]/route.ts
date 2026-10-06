import { getAuthenticatedUserId } from "@/lib/auth";
import { getUpload, appendUpload, completeUpload, deleteUpload } from "@/lib/file-upload-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function handle(req: Request, context: Context, action: (owner: string, id: string) => unknown) {
  const owner = await getAuthenticatedUserId(req);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await action(owner, (await context.params).id)); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: message }, { status: message === "Upload not found" ? 404 : /offset|busy/.test(message) ? 409 : 400 });
  }
}
export function GET(req: Request, context: Context) { return handle(req, context, getUpload); }
export function PUT(req: Request, context: Context) { return handle(req, context, (owner, id) => appendUpload(owner, id, req.headers.has("Upload-Offset") ? Number(req.headers.get("Upload-Offset")) : NaN, req.body)); }
export function POST(req: Request, context: Context) { return handle(req, context, completeUpload); }
export function DELETE(req: Request, context: Context) { return handle(req, context, async (owner, id) => { await deleteUpload(owner, id); return { deleted: true }; }); }
