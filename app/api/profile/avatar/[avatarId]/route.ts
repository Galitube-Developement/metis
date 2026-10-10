import { getAuthenticatedUser } from "@/lib/auth";
import { profileAvatarResponse } from "@/lib/profile-avatars";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, {params}: {params:Promise<{avatarId:string}>}) {
  const [{avatarId},user] = await Promise.all([params,getAuthenticatedUser(req)]);
  return profileAvatarResponse(avatarId,user?.id);
}
