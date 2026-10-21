import { getAuthenticatedUser } from "@/lib/auth";
import { readChatTodos } from "@/lib/chat-page-store";
import { getDatabase } from "@/lib/sqlite";
import { ensureChatPage } from "@/lib/chat-page-loader";
import { canAccessChat } from "@/lib/project-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if(!canAccessChat(id,user.id))return Response.json({error:"Not found"},{status:404});
  try{await ensureChatPage(id);}catch{return Response.json({error:"History is being prepared"},{status:503});}
  return Response.json({ currentTodos: readChatTodos(getDatabase(),id) }, { headers: { "Cache-Control": "private, no-store" } });
}
