import { getAuthenticatedUserId } from "@/lib/auth";
import { createNotification, getNotificationFeed, setNotificationPrefs } from "@/lib/notification-store";
import { listRemoteClients } from "@/lib/remote-clients";
import { notificationCapability } from "@/lib/notification-remote";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return response({ error: "Unauthorized" }, 401);
  const after = new URL(req.url).searchParams.get("after");
  if (after !== null && (!/^[0-9]+$/.test(after) || !Number.isSafeInteger(Number(after)))) return response({error:"Invalid cursor"},400);
  return response({ ...getNotificationFeed(ownerId, after === null ? undefined : Number(after)),
    clients: listRemoteClients(ownerId).map(client => ({ id:client.id, name:client.name, status:client.status, nativeNotifications:notificationCapability(client.id,ownerId) })) });
}
export async function PATCH(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return response({ error: "Unauthorized" },401);
  try { return response({prefs:setNotificationPrefs(ownerId,await req.json())}); }
  catch { return response({error:"Invalid preferences or unavailable remote client"},400); }
}
export async function POST(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return response({error:"Unauthorized"},401);
  try { return response({notification:createNotification(ownerId,await req.json())},201); }
  catch { return response({error:"Invalid notification or unavailable chat"},400); }
}
