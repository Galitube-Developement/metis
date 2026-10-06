import { getAuthenticatedUserId } from "@/lib/auth";
import { getCompletedUpload, completedUploadPath } from "@/lib/file-upload-store";
import { officePreviewResponse } from "@/lib/office-preview";
import { effectiveFileMime } from "@/lib/file-types";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}) {
  const owner=await getAuthenticatedUserId(req);
  if(!owner)return Response.json({error:"Unauthorized"},{status:401});
  try { const id=(await params).id,asset=getCompletedUpload(owner,id); return officePreviewResponse(completedUploadPath(owner,id),effectiveFileMime(asset.mimeType,asset.name)); }
  catch { return Response.json({error:"File not found"},{status:404}); }
}
