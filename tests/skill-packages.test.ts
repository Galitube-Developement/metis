import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { listSkillFiles, readSkillFile } from "../lib/skill-files";
import { listInstalledSkills, skillEnabled, isAlwaysOnSkill } from "../lib/skills";

test("Skill Creator is bundled, enabled by default and exposes a complete package", () => {
  const skill = listInstalledSkills().find(item => item.id === "skill-creator");
  assert.equal(skill?.sourceType, "bundled");
  assert.equal(skillEnabled("skill-creator"), true);
  assert.equal(isAlwaysOnSkill("skill-creator"), false);
  const files = listSkillFiles("skill-creator");
  for (const file of ["SKILL.md", "license.txt", "references/openai_yaml.md", "scripts/init_skill.py", "scripts/quick_validate.py"]) assert.ok(files.some(item => item.path === file), file);
  assert.match(readSkillFile("skill-creator", "SKILL.md").content, /Metis integration/);
  assert.equal(readSkillFile("skill-creator", "assets/skill-creator.png").kind, "image");
});

test("Package previews reject traversal, unknown files", () => {
  for (const file of ["../SKILL.md", "../../.env", "/etc/passwd", ".env", "not-found.md"]) assert.throws(() => readSkillFile("skill-creator", file), /File not found/);
  assert.throws(() => listSkillFiles("unknown-skill"), /Skill not found/);
});

test("Package browsing excludes secrets and symlinks and rejects external package roots", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-skill-package-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "metis-skill-outside-"));
  try {
    mkdirSync(path.join(root, "skills", "sample"), { recursive: true });
    writeFileSync(path.join(root, "skills/sample/SKILL.md"), "# Sample");
    writeFileSync(path.join(root, "skills/sample/.env"), "SECRET=hidden");
    writeFileSync(path.join(outside, "private.md"), "private");
    symlinkSync(path.join(outside, "private.md"), path.join(root, "skills/sample/link.md"));
    symlinkSync(outside, path.join(root, "skills/external"));
    writeFileSync(path.join(root, "skills-lock.json"), JSON.stringify({ skills: { sample: { skillPath: "skills/sample/SKILL.md" }, external: { skillPath: "skills/external/private.md" } } }));
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import skillFiles from './lib/skill-files.ts';
      const {listSkillFiles,readSkillFile}=skillFiles;
      assert.deepEqual(listSkillFiles('sample').map(item=>item.path),['SKILL.md']);
      assert.throws(()=>readSkillFile('sample','link.md'),/File not found/);
      assert.throws(()=>listSkillFiles('external'),/outside the workspace/);
      console.log('PACKAGE_ISOLATION_OK');
    `], { cwd: process.cwd(), env: { ...process.env, AI_CHAT_ROOT: root }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PACKAGE_ISOLATION_OK/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
