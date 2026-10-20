import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  alwaysOnSkillsPrompt,
  enabledSkills,
  isAlwaysOnSkill,
  listInstalledSkills,
  listSkillSettings,
  parseSkillFrontmatter,
  projectSkillSettings,
  skillEnabled,
 addManualSkill,
  skillsCatalogPrompt,
} from "../lib/skills";
import { autoSkillActivationPrompt, isVisualDesignTask } from "../lib/skill-routing";

test("installed skills come from the lockfile and default to enabled", () => {
  const skills = listInstalledSkills();
  assert.ok(skills.length >= 1);
  assert.ok(skills.every((skill) => skill.id && skill.skillPath));
  assert.equal(skillEnabled(skills[0].id), true);
  assert.equal(skillEnabled(skills[0].id, { enabledSkills: { [skills[0].id]: false } }), false);
});

test("disabled skills are omitted from the agent catalog", () => {
  const skills = listInstalledSkills();
  const disabled = Object.fromEntries(skills.map((skill) => [skill.id, false]));
  assert.equal(enabledSkills({ enabledSkills: disabled }).length, 0);
  assert.equal(skillsCatalogPrompt({ enabledSkills: disabled }), "");
  const catalog = skillsCatalogPrompt();
  assert.match(catalog, /Installed skills/);
  assert.ok(skills.some((skill) => catalog.includes(skill.id)));
});

test("project skill settings default every installed skill on and apply project disables", () => {
  const installed = listInstalledSkills();
  assert.ok(installed.length > 1);
  const first = installed[0];
  const second = installed[1];
  const settings = projectSkillSettings(
    { enabledSkills: { [first.id]: false, [second.id]: false } },
    { disabledSkillIds: [second.id] },
  );
  assert.equal(skillEnabled(first.id, settings), true);
  assert.equal(skillEnabled(second.id, settings), false);
  assert.equal(enabledSkills(projectSkillSettings(undefined, { disabledSkillIds: [] })).length, installed.length);
});

test("manual skills reject unsafe ids", () => {
 assert.throws(() => addManualSkill("../outside", "# Skill"), /Skill id/);
});


test("skills resolve CLI installs through the canonical .agents directory", () => {
  const skills = listInstalledSkills();
  const design = skills.find((skill) => skill.id === "ui-ux-pro-max");
  assert.ok(design, "ui-ux-pro-max should be installed");
  assert.match(design.skillPath, /\.agents\/skills\/ui-ux-pro-max\/SKILL\.md$/);
  assert.equal(existsSync(path.resolve(process.cwd(), design.skillPath)), true);
});

test("visual work routes exclusively to UI UX Pro Max for matching tasks", () => {
  for (const message of ["Mache die Handy UI overall cleaner, weniger AI look und fixe Farben", "Review the UI accessibility", "Change the button spacing"]) {
    assert.equal(isVisualDesignTask(message), true);
    const prompt = autoSkillActivationPrompt(message);
    assert.match(prompt, /UI UX Pro Max is active/);
    assert.match(prompt, /- ui-ux-pro-max: .*SKILL\.md/);
    assert.equal(prompt.split("\n").filter(line => line.startsWith("- ")).length, 1);
  }
  for (const id of ["metis-design-director", "frontend-design", "design-taste-frontend", "design-system", "web-design-guidelines", "web-design-reviewer"]) {
    assert.equal(listInstalledSkills().some(skill => skill.id === id), false, `${id} must be replaced`);
  }
  assert.equal(autoSkillActivationPrompt("Erkläre mir prepared statements"), "");
});

test("auto skill routing respects manual skill disable switches", () => {
  const message = "Redesign the mobile UI and audit the layout";
  assert.equal(autoSkillActivationPrompt(message, {
    enabledSkills: { "ui-ux-pro-max": false },
  }), "");
  assert.equal(autoSkillActivationPrompt(message, undefined, { installedSkills: [] }), "");
});


test("i-have-adhd is always-on while enabled and omitted from the match catalog", () => {
  const catalog = skillsCatalogPrompt();
  assert.doesNotMatch(catalog, /i-have-adhd/);
  const alwaysOn = alwaysOnSkillsPrompt();
  assert.match(alwaysOn, /Always-on skill i-have-adhd/);
  assert.match(alwaysOn, /Lead with the next action/);
  assert.doesNotMatch(alwaysOnSkillsPrompt({ enabledSkills: { "i-have-adhd": false } }), /Always-on skill i-have-adhd/);
});

test("users can turn always-on off or on per skill", () => {
  assert.equal(isAlwaysOnSkill("i-have-adhd"), true);
  assert.equal(isAlwaysOnSkill("i-have-adhd", { alwaysOnSkills: { "i-have-adhd": false } }), false);
  assert.equal(isAlwaysOnSkill("playwright", { alwaysOnSkills: { playwright: true } }), true);
  const off = skillsCatalogPrompt({ alwaysOnSkills: { "i-have-adhd": false } });
  assert.match(off, /i-have-adhd/);
  assert.doesNotMatch(alwaysOnSkillsPrompt({ alwaysOnSkills: { "i-have-adhd": false } }), /Always-on skill i-have-adhd/);
  const extra = alwaysOnSkillsPrompt({ alwaysOnSkills: { playwright: true } });
  assert.match(extra, /Always-on skill i-have-adhd/);
  assert.match(extra, /Always-on skill playwright/);
});

test("skill settings expose frontmatter titles and extra metadata", () => {
  const adhd = parseSkillFrontmatter(`---\nname: i-have-adhd\ndescription: 'Shape output. Invoke with /i-have-adhd; stays on until "stop adhd mode".'\nlicense: MIT\nmetadata:\n  tags: "ADHD, Output Style, Productivity"\n  category: "productivity"\n---\n\n# Title\n`);
  assert.equal(adhd.title, "i-have-adhd");
  assert.match(adhd.description, /stop adhd mode/);
  assert.equal(adhd.license, "MIT");
  assert.equal(adhd.category, "productivity");
  assert.deepEqual(adhd.tags, ["ADHD", "Output Style", "Productivity"]);
  const listed = listSkillSettings();
  const design = listed.find((skill) => skill.id === "ui-ux-pro-max");
  assert.ok(design);
  assert.equal(design.title, "ui-ux-pro-max");
  assert.ok(design.description.length > 20);
  assert.equal(design.alwaysOn, false);
  assert.ok(design.skillPath);
  const alwaysOn = listed.find((skill) => skill.id === "i-have-adhd");
  assert.equal(alwaysOn?.alwaysOn, true);
  assert.equal(alwaysOn?.title, "i-have-adhd");
  assert.equal(alwaysOn?.category, "productivity");
  assert.ok((alwaysOn?.tags || []).includes("ADHD"));
});

test("skills settings UI lists titles, descriptions, and always-on inside a collapsible", () => {
  const source = readFileSync(path.join(process.cwd(), "components", "skills-settings.tsx"), "utf8");
  assert.match(source, /skill\.title/);
  assert.match(source, /skill\.description/);
  assert.match(source, /SkillFacts/);
  assert.match(source, /alwaysOnSkills/);
  assert.match(source, /Collapsible/);
  assert.match(source, /Always on/);
  assert.match(source, /CollapsibleTrigger/);
});
