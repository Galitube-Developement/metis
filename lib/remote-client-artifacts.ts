import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export const WINDOWS_INSTALLER = "Metis-AI-Remote-Client-Setup.exe";
export const WINDOWS_UPDATE_METADATA = "latest.yml";
export const WINDOWS_ARTIFACTS = new Set([WINDOWS_INSTALLER, WINDOWS_UPDATE_METADATA]);

// The official Metis server keeps a Windows-built installer. Self-hosted
// servers proxy it when no local copy has been deployed.
const DEFAULT_DISTRIBUTION_URL = "https://ai.f1shy312.com/api/remote-clients/windows-distribution/";

type ArtifactOptions = {
  dataDir: string;
  disposition?: "attachment" | "inline";
  publicCache?: boolean;
};

function headersFor(filename: string, size: string | null, options: ArtifactOptions) {
  const headers = new Headers({
    "Content-Type": filename === WINDOWS_UPDATE_METADATA
      ? "text/yaml; charset=utf-8"
      : "application/vnd.microsoft.portable-executable",
    "Content-Disposition": (options.disposition || "inline") + '; filename="' + filename + '"',
    "Cache-Control": options.publicCache ? "public, max-age=300" : "private, no-store",
  });
  if (size) headers.set("Content-Length", size);
  return headers;
}

export function localWindowsArtifact(filename: string, options: ArtifactOptions): Response | null {
  if (!WINDOWS_ARTIFACTS.has(filename)) return null;
  const file = path.join(options.dataDir, "remote-client-artifacts", filename);
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size < 1) return null;
    size = stat.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, {
    headers: headersFor(filename, String(size), options),
  });
}

export async function windowsArtifact(
  filename: string,
  options: ArtifactOptions & {
    sourceUrl?: string;
    fetcher?: typeof fetch;
  },
): Promise<Response | null> {
  const local = localWindowsArtifact(filename, options);
  if (local || !WINDOWS_ARTIFACTS.has(filename)) return local;

  const baseUrl = options.sourceUrl
    || process.env.METIS_REMOTE_CLIENT_DISTRIBUTION_URL?.trim()
    || DEFAULT_DISTRIBUTION_URL;
  let url: URL;
  try {
    url = new URL(filename, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    if (!["https:", "http:"].includes(url.protocol)) return null;
  } catch {
    return null;
  }

  try {
    const upstream = await (options.fetcher || fetch)(url, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(600_000),
    });
    if (!upstream.ok || !upstream.body) return null;
    // A misconfigured distributor must not be served as an EXE or YAML file.
    const contentType = upstream.headers.get("content-type") || "";
    const expectedType = filename === WINDOWS_UPDATE_METADATA
      ? contentType.startsWith("text/yaml")
      : contentType.startsWith("application/vnd.microsoft.portable-executable");
    if (!expectedType) {
      await upstream.body.cancel();
      return null;
    }
    // Fetch may decompress YAML while preserving the upstream Content-Length.
    return new Response(upstream.body, {
      headers: headersFor(filename, null, options),
    });
  } catch {
    return null;
  }
}
