import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..");

test("OS user fields are a dropdown plus free text", () => {
  const field = readFileSync(path.join(root, "components/os-user-field.tsx"), "utf8");
  const panel = readFileSync(path.join(root, "components/admin-users-panel.tsx"), "utf8");
  const wizard = readFileSync(path.join(root, "components/setup-wizard.tsx"), "utf8");
  const linux = readFileSync(path.join(root, "install/linux.sh"), "utf8");
  const macos = readFileSync(path.join(root, "install/macos.sh"), "utf8");
  const config = readFileSync(path.join(root, "lib/config.ts"), "utf8");
  assert.match(field, /datalist/);
  assert.match(field, /Select or type an OS user/);
  assert.match(panel, /os-user-field/);
  assert.match(wizard, /os-user-field/);
  assert.match(linux, /AI_CHAT_ALLOW_ROOT_AGENTS=true/);
  assert.match(macos, /AI_CHAT_ALLOW_ROOT_AGENTS=true/);
  assert.match(config, /defaultAllowRootAgents/);
});
