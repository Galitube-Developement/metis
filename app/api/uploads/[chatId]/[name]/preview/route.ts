import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat } from "@/lib/db-store";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripXml(value: string) {
  return value
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/(?:t|v)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unzipText(filePath: string, entries: string[]) {
  return entries
    .map((entry) => {
      try {
        return execFileSync("unzip", ["-p", filePath, entry], {
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
        });
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .map(stripXml)
    .filter(Boolean)
    .join("\n\n");
}

function officePreview(filePath: string, mimeType: string) {
  if (mimeType.includes("wordprocessingml")) {
    return unzipText(filePath, [
      "word/document.xml",
      "word/header1.xml",
      "word/footer1.xml",
    ]);
  }
  if (mimeType.includes("spreadsheetml")) {
    return unzipText(filePath, [
      "xl/sharedStrings.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  }
  if (mimeType.includes("presentationml")) {
    return unzipText(filePath, [
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide3.xml",
    ]);
  }
  return "";
}

type Params = { params: Promise<{ chatId: string; name: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { chatId, name } = await params;
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const chat = getChat(chatId, ownerId);
  if (!chat) return Response.json({ error: "Not found" }, { status: 404 });

  const storedName = decodeURIComponent(name);
  const attachment = chat.messages
    .flatMap((message) => message.attachments ?? [])
    .find((item) => item.storedName === storedName);
  const filePath = resolveUploadPath(chatId, storedName, ownerId);
  if (!attachment || !filePath) return Response.json({ error: "File not found" }, { status: 404 });

  if (statSync(filePath).size > 20 * 1024 * 1024) return Response.json({ error: "Preview unavailable for large office files. Download the file to open it." }, { status: 413 });
  const preview = officePreview(filePath, attachment.mimeType);
  if (!preview) return Response.json({ error: "Preview unavailable for this file." }, { status: 415 });
  return new Response(preview, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
