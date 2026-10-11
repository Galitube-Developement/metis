import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";

export async function requireHostAdmin(req: Request) {
  if (!(await isAuthenticated(req))) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: userId! };
}
