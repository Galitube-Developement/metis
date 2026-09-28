import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { config } from "@/lib/config";
import { authenticateRemoteClient } from "@/lib/remote-clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const installer = "Metis-AI-Remote-Client-Setup.exe";
const metadata = "latest.yml";
const allowedFiles = new Set([installer, metadata]);

type Params = { params: Promise<{ filename: string }> };

export async function GET(req: Request, { params }: Params) {
  const clientId = req.headers.get("x-metis-client-id")?.trim();
  const auth = req.headers.get("authorization") || "";
  const credential = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!clientId || !credential || !authenticateRemoteClient(clientId, credential, false)) {
    return Response.json({ error: "Invalid or revoked client credentials" }, { status: 401 });
  }

  const { filename } = await params;
  if (!allowedFiles.has(filename)) return Response.json({ error: "Update artifact not found" }, { status: 404 });

  const file = path.join(config.dataDir, "remote-client-artifacts", filename);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return Response.json({ error: "Update artifact not found" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": filename === metadata
        ? "text/yaml; charset=utf-8"
        : "application/vnd.microsoft.portable-executable",
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
