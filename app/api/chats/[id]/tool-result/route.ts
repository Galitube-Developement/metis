import { getAuthenticatedUser } from "@/lib/auth";
import { getDatabase } from "@/lib/sqlite";
import { canAccessChat } from "@/lib/project-access";
import { ensureChatPage } from "@/lib/chat-page-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const query = new URL(req.url).searchParams;
  const messageId = query.get("messageId") || "";
  const toolId = query.get("toolId") || "";
  if (!messageId || !toolId) return Response.json({ error: "messageId and toolId are required" }, { status: 400 });
  if(!canAccessChat(id,user.id))return Response.json({ error: "Not found" }, { status: 404 });
  await ensureChatPage(id);
  const row=getDatabase().prepare("SELECT data FROM chat_page_tools WHERE chat_id=? AND message_id=? AND tool_id=?").get(id,messageId,toolId) as {data:string}|undefined;
  const tool=row?JSON.parse(row.data):undefined;
  if (!tool || (!("result" in tool) || typeof tool.result !== "string") && (!("input" in tool) || typeof tool.input !== "string") && !tool.subagent && !tool.diff) {
    return Response.json({ error: "Tool output not found" }, { status: 404 });
  }
  return Response.json({
    ...("result" in tool && typeof tool.result === "string" ? { result: tool.result } : {}),
    ...("input" in tool && typeof tool.input === "string" ? { input: tool.input } : {}),
    ...(tool.subagent ? { subagent: tool.subagent } : {}),
    ...(tool.diff ? { diff: tool.diff } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
