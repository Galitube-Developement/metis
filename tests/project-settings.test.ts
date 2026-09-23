import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");
const home = read("components", "project-home.tsx");
const skills = read("components", "project-skills-manager.tsx");
const memory = read("components", "project-memory-manager.tsx");
const projectApi = read("app", "api", "projects", "[id]", "route.ts");
const memoryGateway = read("app", "api", "internal", "mcp-memory", "route.ts");
const projects = read("lib", "projects.ts");
const worker = read("lib", "worker-runner.ts");
const providerPrompt = read("lib", "providers", "prompt-context.ts");

test("Project Home exposes two-column drag and button controls for per-project skills", () => {
  assert.match(home, /<ProjectSkillsManager/);
  assert.match(skills, /DndContext/);
  assert.match(skills, /data-project-skills-column=\{id\}/);
  assert.match(skills, /title="Disabled"/);
  assert.match(skills, /title="Enabled"/);
  assert.match(skills, /aria-label=\{enabled \? .*Disable/);
  assert.match(skills, /data-slot="project-skill-details"/);
  assert.match(skills, /Show SKILL\.md/);
  assert.match(skills, /SkillFacts/);
  assert.match(skills, /\/api\/skills\?read=/);
  assert.match(projectApi, /disabledSkillIds\?: string\[\]/);
});

test("project skills are applied to both provider prompt paths", () => {
  assert.match(worker, /projectSkillSettings\(globalModelSettings, project\)/);
  assert.match(worker, /skillsCatalogPrompt\(skillSettings\)/);
  assert.match(providerPrompt, /projectSkillSettings\(getGlobalModelSettings\(ownerId\), project\)/);
  assert.match(providerPrompt, /autoSkillActivationPrompt\(job\.message, skillSettings/);
});

test("Project Home manages durable project memory used by agents and memory tools", () => {
  assert.match(home, /<ProjectMemoryManager/);
  assert.match(memory, /Add memory/);
  assert.match(memory, /Save memory/);
  assert.match(memory, /Delete project memory/);
  assert.match(memory, /rows=\{1\}/);
  assert.match(memory, /min-h-8 resize-y rounded-lg py-1 leading-5/);
  assert.match(memory, /className="h-8 shrink-0 sm:self-end"/);
  assert.doesNotMatch(memory, /min-h-20/);
  assert.doesNotMatch(memory, /className="h-10 sm:self-end"/);
  assert.match(projects, /Project memory \(durable facts managed from Project Home and memory tools\)/);
  assert.match(memoryGateway, /projectId \? listProjectMemories/);
  assert.match(memoryGateway, /projectId\s*\? createProjectMemory/);
  assert.match(memoryGateway, /projectId \? deleteProjectMemory/);
});
