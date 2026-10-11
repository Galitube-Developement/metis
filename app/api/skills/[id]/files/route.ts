import { isAuthenticated } from "@/lib/auth";
import { listSkillFiles, readSkillFile } from "@/lib/skill-files";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const file = new URL(req.url).searchParams.get("path");
    return Response.json(file ? readSkillFile(id, file) : { files: listSkillFiles(id) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read skill package" }, { status: 404 });
  }
}
