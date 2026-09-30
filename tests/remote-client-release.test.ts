import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyWindowsUpdate,
  WINDOWS_INSTALLER,
  WINDOWS_INSTALLER_URL,
  WINDOWS_RELEASE_BASE,
  WINDOWS_UPDATE_METADATA,
  windowsReleaseUrl,
} from "../lib/remote-client-release";

test("Windows client files come from public GitHub releases", () => {
  assert.equal(WINDOWS_INSTALLER_URL, "https://github.com/f1shyondrugs/metis-remote-client/releases/latest/download/Metis-AI-Remote-Client-Setup.exe");
  assert.equal(windowsReleaseUrl(WINDOWS_UPDATE_METADATA), WINDOWS_RELEASE_BASE + "latest.yml");
  assert.equal(windowsReleaseUrl("../secret"), null);
});

test("legacy paired-client update proxies release assets without forwarding credentials", async () => {
  const requested: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requested.push({ url: String(input), init });
    return new Response("version: 1.3.6\n", { headers: { "content-type": "application/octet-stream" } });
  }) as typeof fetch;
  const response = await legacyWindowsUpdate(WINDOWS_UPDATE_METADATA, fetcher);
  assert.equal(response?.status, 200);
  assert.equal(await response?.text(), "version: 1.3.6\n");
  assert.deepEqual(requested.map((request) => request.url), [WINDOWS_RELEASE_BASE + WINDOWS_UPDATE_METADATA]);
  assert.equal(requested[0]?.init?.headers, undefined);
  assert.equal(response?.headers.get("content-type"), "text/yaml; charset=utf-8");
});

test("legacy proxy rejects unknown files and error documents", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response('{"error":"missing"}', { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.equal(await legacyWindowsUpdate("../secret", fetcher), null);
  assert.equal(calls, 0);
  assert.equal(await legacyWindowsUpdate(WINDOWS_INSTALLER, fetcher), null);
  assert.equal(calls, 1);
});
