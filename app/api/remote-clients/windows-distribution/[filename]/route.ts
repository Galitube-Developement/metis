import { windowsReleaseUrl } from "@/lib/remote-client-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ filename: string }> };

// Keep old public download links valid while GitHub Releases owns the binaries.
export async function GET(_req: Request, { params }: Params) {
  const { filename } = await params;
  const url = windowsReleaseUrl(filename);
  return url
    ? Response.redirect(url, 302)
    : Response.json({ error: "Artifact not found" }, { status: 404 });
}
