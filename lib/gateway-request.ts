import { getAuthenticatedUserId } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";

type GatewayResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

/** Preserve gateway errors and reject malformed JSON before returning API data. */
export function gatewayResultJson(result: GatewayResult): unknown {
  const text = result.content?.map((item) => item.text || "").join("\n") || "";
  if (result.isError) throw new Error(text || "MCP operation failed");
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error("MCP operation returned invalid JSON"); }
}

/** Keep account and host-admin context identical for HTTP gateway callers. */
export async function gatewayToolForRequest(req: Request, name: string, args: Record<string, unknown> = {}) {
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  // @ts-expect-error The shared ESM gateway runtime has no generated declarations.
  const { dispatchGatewayTool } = await import("@/packages/mcp-gateway/index.mjs");
  const result = await dispatchGatewayTool(name, args, {
    context: { userId, isHostAdmin: isHostAdmin(userId) },
  }) as GatewayResult;
  return gatewayResultJson(result);
}
