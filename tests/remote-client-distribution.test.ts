import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("Windows Remote Client builds stay out of GitHub Releases", () => {
  const workflow = read(".github/workflows/remote-client-windows.yml");
  const desktopPackage = JSON.parse(read("remote-client/desktop/package.json")) as {
    build: { publish: Array<{ provider: string; url?: string }> };
  };

  assert.doesNotMatch(workflow, /^\s*release:\s*$/m);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /--publish always|GH_TOKEN/);
  assert.match(workflow, /dist\/Metis-AI-Remote-Client-Setup\.exe/);
  assert.match(workflow, /dist\/latest\.yml/);
  assert.deepEqual(desktopPackage.build.publish, [{
    provider: "generic",
    url: "https://metis.invalid/api/remote-clients/windows-updates",
  }]);
});

test("paired server authenticates downloads and mirrors only known public binaries", () => {
  const installerRoute = read("app/api/remote-clients/windows-installer/route.ts");
  const updateRoute = read("app/api/remote-clients/windows-updates/[filename]/route.ts");
  const distributionRoute = read("app/api/remote-clients/windows-distribution/[filename]/route.ts");
  const artifacts = read("lib/remote-client-artifacts.ts");
  const desktopMain = read("remote-client/desktop/main.cjs");

  assert.match(installerRoute, /isAuthenticated\(req\)/);
  assert.match(installerRoute, /windowsArtifact\(WINDOWS_INSTALLER/);
  assert.match(updateRoute, /authenticateRemoteClient/);
  assert.match(updateRoute, /WINDOWS_ARTIFACTS\.has\(filename\)/);
  assert.match(distributionRoute, /localWindowsArtifact/);
  assert.doesNotMatch(distributionRoute, /windowsArtifact\(/);
  assert.match(artifacts, /DEFAULT_DISTRIBUTION_URL/);
  assert.match(artifacts, /remote-client-artifacts/);
  assert.match(desktopMain, /url: `\$\{config\.server\}\/api\/remote-clients\/windows-updates`/);
  assert.match(desktopMain, /"x-metis-client-id": config\.clientId/);
  assert.match(desktopMain, /Authorization: `Bearer \$\{config\.credential\}`/);
});
