import { getAuthenticatedUser } from "@/lib/auth";
import { getChat } from "@/lib/db-store";

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
  const message = getChat(id, user.id)?.messages.find(message => message.id === messageId);
  const tool = message?.tools?.find(tool => tool.id === toolId)
    || message?.parts?.find(part => part.type === "tool" && part.id === toolId);
  if (!tool || !("result" in tool) || typeof tool.result !== "string") {
    return Response.json({ error: "Tool output not found" }, { status: 404 });
  }
  return Response.json({ result: tool.result }, { headers: { "Cache-Control": "private, no-store" } });
}
