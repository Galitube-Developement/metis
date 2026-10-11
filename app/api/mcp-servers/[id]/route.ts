import { gatewayToolForRequest as gatewayTool } from "@/lib/gateway-request";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) {
    return Response.json({ error: "Only host administrators can change MCP servers." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const result = await gatewayTool(req, "set_mcp_server_enabled", { server: id, enabled: body.enabled });
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update MCP server" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) {
    return Response.json({ error: "Only host administrators can change MCP servers." }, { status: 403 });
  }
  const { id } = await params;
  try {
    // removeMcpServer changes only the local registry and closes a cached child.
    // @ts-expect-error The shared gateway core is an ESM runtime module.
    const { removeMcpServer } = await import("@/packages/mcp-gateway/index.mjs");
    if (!(await removeMcpServer(id, { userId: (await getAuthenticatedUserId(req)) ?? undefined }))) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete MCP server" }, { status: 400 });
  }
}
