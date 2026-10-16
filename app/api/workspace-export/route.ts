import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/auth";
import { getChat } from "@/lib/db-store";
import { documentExportName, markdownPlainText } from "@/lib/document-export";
import { documentExportPdf, ExportBusyError } from "@/lib/document-export-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exportInput = z.object({
  chatId: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200),
  name: z.string().max(200), content: z.string().max(100_000), format: z.enum(["md", "txt", "pdf"]),
});

export async function POST(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = exportInput.safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid export request" }, { status: 400 });
  const { chatId, workspaceId, name, content, format } = input.data;
  const chat = getChat(chatId, ownerId);
  const workspaceExists = chat?.workspaces?.some((item) => item.id === workspaceId)
    || (chat && !chat.workspaces?.length && chat.canvas && workspaceId === "canvas-default");
  if (!workspaceExists) return Response.json({ error: "Workspace not found" }, { status: 404 });
  try {
    const result = format === "pdf" ? new Uint8Array(await documentExportPdf(name, content, req.signal))
      : format === "txt" ? markdownPlainText(content) : content;
    return new Response(result, { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(documentExportName(name, format)),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const missingBrowser = error instanceof Error && /Executable doesn't exist/.test(error.message);
    return Response.json({ error: missingBrowser
      ? "PDF export requires Chromium. Install the browser engine in Settings and try again."
      : error instanceof ExportBusyError ? error.message : "The document could not be exported. Please try again.",
    }, { status: error instanceof ExportBusyError || missingBrowser ? 503 : 500 });
  }
}
