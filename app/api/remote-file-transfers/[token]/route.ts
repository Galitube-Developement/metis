import { remoteTransferDownload } from "@/lib/remote-file-transfer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return remoteTransferDownload((await params).token, req);
}
