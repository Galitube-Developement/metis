import { randomBytes } from "node:crypto";
import { getDatabase } from "@/lib/sqlite";
import { getGlobalModelSettings } from "@/lib/db-store";
import { listInstalledSkills, parseSkillFrontmatter } from "@/lib/skills";
import { listSkillFiles, readSkillFile } from "@/lib/skill-files";
import { addPersonalSkill, validateSkillPackage, type SkillPackageFile } from "@/lib/personal-skills";
import { isHostAdmin } from "@/lib/user-access";

export type SharedSkill = { id: string; title: string; description: string; createdAt: string; files: SkillPackageFile[] };
function database() {
  const db = getDatabase();
  db.exec("CREATE TABLE IF NOT EXISTS skill_shares (token TEXT PRIMARY KEY, owner_id TEXT NOT NULL, skill_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS skill_shares_owner ON skill_shares(owner_id, skill_id);");
  return db;
}
export function canShareSkill(ownerId: string, id: string) {
  const skill = listInstalledSkills(getGlobalModelSettings(ownerId)).find(item => item.id === id);
  return Boolean(skill && (skill.sourceType === "personal" || (skill.sourceType === "local" && isHostAdmin(ownerId))));
}
export function skillShareLink(ownerId: string, id: string) {
  const row = database().prepare("SELECT token FROM skill_shares WHERE owner_id = ? AND skill_id = ? ORDER BY created_at DESC LIMIT 1").get(ownerId, id) as { token: string } | undefined;
  return row?.token ?? null;
}
export function createSkillShare(ownerId: string, id: string) {
  if (!canShareSkill(ownerId, id)) throw new Error("Only your own manual skills can be shared.");
  const existing = skillShareLink(ownerId, id);
  if (existing) return existing;
  const settings = getGlobalModelSettings(ownerId);
  const files: SkillPackageFile[] = listSkillFiles(id, settings).map(file => {
    const preview = readSkillFile(id, file.path, settings);
    return { path: file.path, content: preview.content, encoding: file.kind === "image" ? "base64" : "utf8" };
  });
  validateSkillPackage(files);
  const meta = parseSkillFrontmatter(files.find(file => file.path === "SKILL.md")!.content);
  const createdAt = new Date().toISOString();
  const payload: SharedSkill = { id, title: meta.title || id, description: meta.description, createdAt, files };
  const token = randomBytes(24).toString("hex");
  database().prepare("INSERT INTO skill_shares (token, owner_id, skill_id, data, created_at) VALUES (?,?,?,?,?)").run(token, ownerId, id, JSON.stringify(payload), createdAt);
  return token;
}
export function getSharedSkill(token: string): SharedSkill | null {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const row = database().prepare("SELECT data FROM skill_shares WHERE token = ?").get(token) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as SharedSkill : null;
}
export function revokeSkillShare(ownerId: string, id: string) {
  database().prepare("DELETE FROM skill_shares WHERE owner_id = ? AND skill_id = ?").run(ownerId, id);
}
export function importSharedSkill(ownerId: string, token: string, id: string) {
  const skill = getSharedSkill(token);
  if (!skill) throw new Error("This share link is unavailable or has been revoked.");
  if (listInstalledSkills(getGlobalModelSettings(ownerId)).some(item => item.id === id)) throw new Error("A skill with this id already exists. Choose another id.");
  return addPersonalSkill(ownerId, id, skill.files);
}
