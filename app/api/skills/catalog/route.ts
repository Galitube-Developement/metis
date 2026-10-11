import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
import { config } from "@/lib/config";
import { SKILL_CATALOG } from "@/lib/skill-catalog";
import { listInstalledSkills } from "@/lib/skills";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let installing = false;
export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ skills: SKILL_CATALOG, canInstall: isHostAdmin(await getAuthenticatedUserId(req)) });
}
export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) return Response.json({ error: "A host administrator must install shared skill packages." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const entry = SKILL_CATALOG.find(item => item.id === body.id);
  if (!entry) return Response.json({ error: "Unknown catalog skill" }, { status: 400 });
  if (installing) return Response.json({ error: "Another skill installation is running. Try again when it finishes." }, { status: 409 });
  installing = true;
  try {
    await promisify(execFile)("npx", ["--yes", "skills", "add", entry.source, "--skill", entry.id, "--agent", "universal", "--yes"], {
      cwd: config.root, timeout: 120_000, maxBuffer: 2_000_000,
      env: { ...process.env, DISABLE_TELEMETRY: "1" },
    });
    if (!listInstalledSkills().some(item => item.id === entry.id)) throw new Error("The installer did not register this skill.");
    return Response.json({ installed: entry.id });
  } catch {
    return Response.json({ error: "Could not install this skill. Check the server network and Skills CLI, then try again." }, { status: 500 });
  } finally { installing = false; }
}
