import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { windowsSetupTokenAclScript, secureWindowsSetupToken } from "../lib/setup-token-windows";

test("Windows token DACL restricts identities, ownership and inheritance with literal paths", () => {
  const script = windowsSetupTokenAclScript("C:\\fixture\\operator's $token", true);
  assert.ok(script.includes("$file = 'C:\\fixture\\operator''s $token'"));
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /operator-owned/);
  assert.match(script, /ReparsePoint/);
  assert.match(script, /S-1-5-18/);
  assert.match(script, /S-1-5-32-544/);
  assert.match(script, /\$trusted -notcontains/);
  assert.doesNotMatch(windowsSetupTokenAclScript("C:\\fixture\\token", false), /Set-Acl/);
});

test("native Windows ACL protects and validates a synthetic token file", { skip: process.platform !== "win32" }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "metis-token-acl-"));
  const file = path.join(directory, "setup-token");
  try {
    writeFileSync(file, "");
    secureWindowsSetupToken(file, true);
    secureWindowsSetupToken(file);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
