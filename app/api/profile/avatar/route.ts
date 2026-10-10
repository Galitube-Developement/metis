import { getAuthenticatedUser } from "@/lib/auth";
import { AvatarUploadError, uploadProfileGif } from "@/lib/profile-avatars";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"private, no-store"};
export async function PUT(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({error:"Unauthorized"},{status:401,headers});
  try {
    return Response.json({avatar:await uploadProfileGif(user.id,req)},{headers});
  } catch (error) {
    return Response.json({error:error instanceof Error ? error.message : "Could not upload GIF."},
      {status:error instanceof AvatarUploadError ? error.status : 500,headers});
  }
}
