import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../install/macos.sh", import.meta.url), "utf8");

test("macOS native installer forces production runtime under launchd", () => {
  assert.match(source, /upsert_env_key "\$install_dir\/.env" NODE_ENV "production"/);
  assert.match(source, /merge_preserved_env "\$install_dir\/.env"[\s\S]*upsert_env_key/);
});

test("macOS installer keeps native launch services isolated", () => {
  assert.match(source, /--service-name NAME/);
  assert.match(source, /LaunchAgents\/\$\{service_name\}-app\.plist/);
  assert.match(source, /Metis AI \(\$service_name\)\.app/);
});
