import { getAuthenticatedUserId } from "@/lib/auth";
import { getAccountUsage, usageRange } from "@/lib/account-usage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const ownerId=await getAuthenticatedUserId(req);
  const headers={"Cache-Control":"private, no-store"};
  if(!ownerId) return Response.json({error:"Unauthorized"},{status:401,headers});
  const url=new URL(req.url);
  let range: ReturnType<typeof usageRange>;
  try { range=usageRange(url.searchParams.get("from"),url.searchParams.get("to")); }
  catch { return Response.json({error:"Choose a valid date range of up to one year."},{status:400,headers}); }
  return Response.json({usage:getAccountUsage(ownerId,range.from,range.to)},{headers});
}
