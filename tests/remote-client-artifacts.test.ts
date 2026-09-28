import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  localWindowsArtifact,
  WINDOWS_INSTALLER,
  WINDOWS_UPDATE_METADATA,
  windowsArtifact,
} from "../lib/remote-client-artifacts";

test("Windows installer uses the local artifact before the distributor", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-windows-artifact-"));
  try {
    const artifactDir = path.join(dataDir, "remote-client-artifacts");
    mkdirSync(artifactDir);
    writeFileSync(path.join(artifactDir, WINDOWS_INSTALLER), "local executable");
    const response = await windowsArtifact(WINDOWS_INSTALLER, {
      dataDir,
      disposition: "attachment",
      fetcher: async () => { throw new Error("network must not be used"); },
    });
    assert.equal(response?.status, 200);
    assert.equal(await response?.text(), "local executable");
    assert.match(response?.headers.get("content-disposition") || "", /^attachment;/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("Windows installer and update metadata stream from the official distributor when absent locally", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-windows-artifact-"));
  const requested: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const executable = url.endsWith(".exe");
    const body = executable ? "exe payload" : "version: 1.3.4";
    return new Response(body, { headers: {
      "content-type": executable ? "application/vnd.microsoft.portable-executable" : "text/yaml",
    } });
  };
  try {
    const setup = await windowsArtifact(WINDOWS_INSTALLER, {
      dataDir,
      sourceUrl: "https://example.test/windows-distribution/",
      fetcher: fetcher as typeof fetch,
    });
    const metadata = await windowsArtifact(WINDOWS_UPDATE_METADATA, {
      dataDir,
      sourceUrl: "https://example.test/windows-distribution/",
      fetcher: fetcher as typeof fetch,
    });
    assert.equal(await setup?.text(), "exe payload");
    assert.equal(await metadata?.text(), "version: 1.3.4");
    assert.deepEqual(requested, [
      "https://example.test/windows-distribution/" + WINDOWS_INSTALLER,
      "https://example.test/windows-distribution/" + WINDOWS_UPDATE_METADATA,
    ]);
    assert.equal(metadata?.headers.get("content-type"), "text/yaml; charset=utf-8");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("distributor rejects unknown, empty, and JSON error artifacts", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-windows-artifact-"));
  try {
    const options = {
      dataDir,
      sourceUrl: "https://example.test/windows-distribution/",
      fetcher: async () => new Response('{"error":"missing"}', {
        headers: { "content-type": "application/json" },
      }),
    };
    assert.equal(localWindowsArtifact("../config.json", options), null);
    assert.equal(await windowsArtifact("../config.json", options), null);
    assert.equal(await windowsArtifact(WINDOWS_INSTALLER, options), null);
    mkdirSync(path.join(dataDir, "remote-client-artifacts"));
    writeFileSync(path.join(dataDir, "remote-client-artifacts", WINDOWS_INSTALLER), "");
    assert.equal(localWindowsArtifact(WINDOWS_INSTALLER, options), null);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
