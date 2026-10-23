import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { exportNoteArchive } from "@/lib/note-archive";
import { NoteValidationError } from "@/lib/shared-context";
import { getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  if (!featureFlags(getGlobalModelSettings(ownerId)).notes) return Response.json({ error: "Notes are disabled" }, { status: 404 });
  const url = new URL(req.url);
  const requested = url.searchParams.get("projectId")?.trim();
  try {
    const bytes = await exportNoteArchive({ ownerId, projectId: requested === "none" ? null : requested || undefined, includeArchived: url.searchParams.get("includeArchived") === "true" });
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="metis-pages.zip"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not export pages" }, { status: error instanceof NoteValidationError ? error.status : 400 });
  }
}
