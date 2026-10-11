import { getAuthenticatedUserId } from "@/lib/auth";
import { captureRemoteDesktop, DesktopPreviewError } from "@/lib/remote-desktop-capture";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only a passive frame. No client-supplied command, operation, or input reaches the device.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 499 });
  try {
    const frame = await captureRemoteDesktop(id, ownerId);
    return new Response(frame.data as Uint8Array<ArrayBuffer>, { headers: {
      "Content-Type": "image/jpeg", "Cache-Control": "private, no-store",
      "X-Desktop-Captured-At": String(frame.capturedAt),
      "X-Desktop-Width": String(frame.width), "X-Desktop-Height": String(frame.height),
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Desktop preview failed" },
      { status: error instanceof DesktopPreviewError ? error.status : 502,
        headers: { "Cache-Control": "private, no-store" } });
  }
}
