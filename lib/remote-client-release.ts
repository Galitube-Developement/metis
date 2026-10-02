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

export type RemoteDesktopDownload = { label: string; url: string };
const UNIX_DESKTOP_ARTIFACTS = {
  macos: [
    { file: "Metis-AI-Remote-Client-arm64.dmg", label: "macOS · Apple Silicon" },
    { file: "Metis-AI-Remote-Client-x64.dmg", label: "macOS · Intel" },
  ],
  linux: [
    { file: "Metis-AI-Remote-Client-x86_64.AppImage", label: "Linux · Intel / AMD" },
    { file: "Metis-AI-Remote-Client-arm64.AppImage", label: "Linux · ARM64" },
  ],
};

const RELEASE_TAG_RE = /^[A-Za-z0-9._-]+$/;

function downloadFor(asset: { file: string; label: string }, tag?: string): RemoteDesktopDownload {
  const url = tag && RELEASE_TAG_RE.test(tag)
    ? `https://github.com/f1shyondrugs/metis-remote-client/releases/download/${tag}/${asset.file}`
    : WINDOWS_RELEASE_BASE + asset.file;
  return { label: asset.label, url };
}

async function latestReleaseAssets(fetcher: typeof fetch): Promise<{ tag: string; names: Set<string> } | null> {
  try {
    const response = await fetcher("https://api.github.com/repos/f1shyondrugs/metis-remote-client/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { tag_name?: string; assets?: Array<{ name?: string }> };
    const tag = String(body.tag_name || "");
    if (!RELEASE_TAG_RE.test(tag)) return null;
    return {
      tag,
      names: new Set(Array.isArray(body.assets) ? body.assets.map((asset) => String(asset.name || "")) : []),
    };
  } catch {
    return null;
  }
}

async function desktopAssetExists(file: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(WINDOWS_RELEASE_BASE + file, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Never offer an installer until the release actually contains it.
export async function remoteDesktopDownloads(platform: "windows" | "macos" | "linux", fetcher: typeof fetch = fetch): Promise<RemoteDesktopDownload[]> {
  if (platform === "windows") return [{ label: "Windows installer", url: WINDOWS_INSTALLER_URL }];
  const latest = await latestReleaseAssets(fetcher);
  if (latest) {
    return UNIX_DESKTOP_ARTIFACTS[platform]
      .filter((asset) => latest.names.has(asset.file))
      .map((asset) => downloadFor(asset, latest.tag));
  }
  const found: RemoteDesktopDownload[] = [];
  for (const asset of UNIX_DESKTOP_ARTIFACTS[platform]) {
    if (await desktopAssetExists(asset.file, fetcher)) found.push(downloadFor(asset));
  }
  return found;
}
