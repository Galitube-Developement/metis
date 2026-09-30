export const WINDOWS_INSTALLER = "Metis-AI-Remote-Client-Setup.exe";
export const WINDOWS_UPDATE_METADATA = "latest.yml";
export const WINDOWS_ARTIFACTS = new Set([WINDOWS_INSTALLER, WINDOWS_UPDATE_METADATA]);
export const WINDOWS_RELEASE_BASE = "https://github.com/f1shyondrugs/metis-remote-client/releases/latest/download/";
export const WINDOWS_INSTALLER_URL = WINDOWS_RELEASE_BASE + WINDOWS_INSTALLER;

export function windowsReleaseUrl(filename: string): string | null {
  return WINDOWS_ARTIFACTS.has(filename) ? WINDOWS_RELEASE_BASE + filename : null;
}

// Existing 1.3.4 clients still request updates through their paired server.
// Proxy the public release body so their pairing credentials never reach GitHub.
export async function legacyWindowsUpdate(filename: string, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const url = windowsReleaseUrl(filename);
  if (!url) return null;
  try {
    const upstream = await fetcher(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(600_000),
    });
    if (!upstream.ok || !upstream.body) return null;
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      await upstream.body.cancel();
      return null;
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": filename === WINDOWS_UPDATE_METADATA
          ? "text/yaml; charset=utf-8"
          : "application/vnd.microsoft.portable-executable",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return null;
  }
}
