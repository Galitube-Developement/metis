import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { enabledSkills, listInstalledSkills, listSkillSettings, readSkillMarkdown } from "@/lib/skills";

import { addPersonalSkill } from "@/lib/personal-skills";
import { isHostAdmin } from "@/lib/user-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseSkills(ownerId?: string) {
 const settings = getGlobalModelSettings(ownerId);
 return {
 skills: listSkillSettings(settings).map(skill => ({ ...skill, shareable: skill.sourceType === "personal" || (skill.sourceType === "local" && isHostAdmin(ownerId ?? null)) })),
 enabled: enabledSkills(settings).map((skill) => skill.id),
 };
}

export async function GET(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const readId = new URL(req.url).searchParams.get("read")?.trim();
 if (readId) {
 const content = readSkillMarkdown(readId, getGlobalModelSettings(ownerId));
 if (content === null) return Response.json({ error: "Skill file not found" }, { status: 404 });
 return Response.json({ id: readId, content });
 }
 return Response.json(responseSkills(ownerId));
}

export async function POST(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = await getAuthenticatedUserId(req);
 if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
 try {
 let id = "";
 let content = "";
 if (req.headers.get("content-type")?.includes("multipart/form-data")) {
 const form = await req.formData();
 id = String(form.get("id") || "");
 content = String(form.get("content") || "");
 const file = form.get("file");
 if (file instanceof File && file.size > 200_000) throw new Error("SKILL.md exceeds 200 KB.");
 if (file instanceof File) {
 content = await file.text();
 if (!id) id = file.name.replace(/\.md$/i, "");
 }
 } else {
 const body = (await req.json()) as { id?: string; content?: string };
 id = body.id || "";
 content = body.content || "";
 }
 if (typeof id !== "string" || typeof content !== "string") throw new Error("Invalid skill.");
 id = id.trim().toLowerCase();
 if (listInstalledSkills(getGlobalModelSettings(ownerId)).some(item => item.id === id)) throw new Error("A skill with this id already exists. Choose another id.");
 const skill = addPersonalSkill(ownerId, id, [{ path: "SKILL.md", content, encoding: "utf8" }]);
 return Response.json({ skill, ...responseSkills((await getAuthenticatedUserId(req)) ?? undefined) }, { status: 201 });
 } catch (cause) {
 const message = cause instanceof Error ? cause.message : "Could not add skill.";
 return Response.json({ error: message }, { status: 400 });
 }
}

export async function PATCH(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const body = (await req.json().catch(() => ({}))) as {
 enabledSkills?: Record<string, boolean>;
 alwaysOnSkills?: Record<string, boolean>;
 };
 const current = getGlobalModelSettings(ownerId);
 const settings = saveGlobalModelSettings({
 ...current,
 enabledSkills: {
 ...(current.enabledSkills || {}),
 ...(body.enabledSkills && typeof body.enabledSkills === "object" ? body.enabledSkills : {}),
 },
 alwaysOnSkills: {
 ...(current.alwaysOnSkills || {}),
 ...(body.alwaysOnSkills && typeof body.alwaysOnSkills === "object" ? body.alwaysOnSkills : {}),
 },
 }, ownerId);
 return Response.json({
 skills: listSkillSettings(settings).map(skill => ({ ...skill, shareable: skill.sourceType === "personal" || (skill.sourceType === "local" && isHostAdmin(ownerId ?? null)) })),
 });
}
