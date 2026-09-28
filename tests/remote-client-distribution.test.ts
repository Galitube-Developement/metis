import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

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

test("installer and updates are served only by the paired Metis server", () => {
  const installerRoute = read("app/api/remote-clients/windows-installer/route.ts");
  const updateRoute = read("app/api/remote-clients/windows-updates/[filename]/route.ts");
  const desktopMain = read("remote-client/desktop/main.cjs");

  assert.doesNotMatch(installerRoute, /github\.com|Response\.redirect/);
  assert.match(installerRoute, /status: 503/);
  assert.match(updateRoute, /authenticateRemoteClient/);
  assert.match(updateRoute, /remote-client-artifacts/);
  assert.match(desktopMain, /url: `\$\{config\.server\}\/api\/remote-clients\/windows-updates`/);
  assert.match(desktopMain, /"x-metis-client-id": config\.clientId/);
  assert.match(desktopMain, /Authorization: `Bearer \$\{config\.credential\}`/);
});
