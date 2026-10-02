import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { createMemory, listMemories } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = new URL(req.url).searchParams.get("q")?.trim().toLocaleLowerCase();
  const memories = listMemories((await getAuthenticatedUserId(req)) ?? undefined)
    .filter((memory) => memory.state !== "superseded" && memory.state !== "archived")
    .filter((memory) => !query || [memory.content, memory.namespace, memory.topic, ...(memory.tags || [])]
      .some((value) => value?.toLocaleLowerCase().includes(query)));
  return Response.json({ memories });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { content?: string; tags?: string[] };
  try {
    body = (await req.json()) as { content?: string; tags?: string[] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  const memory = createMemory(content, body.tags, (await getAuthenticatedUserId(req)) ?? undefined);
  return Response.json({ memory }, { status: 201 });
}
