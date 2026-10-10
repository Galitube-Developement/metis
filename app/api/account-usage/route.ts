import { getAuthenticatedUserId } from "@/lib/auth";
import { getAccountUsage, getAccountModelUsage, usageRange } from "@/lib/account-usage";
import { loadApiPrices } from "@/lib/api-price-catalog";
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
  const modelId=url.searchParams.get("modelId"),providerId=url.searchParams.get("providerId");
  if(modelId !== null || providerId !== null) {
    if(!modelId || !providerId || modelId.length>512 || providerId.length>128)
      return Response.json({error:"Choose a model and provider."},{status:400,headers});
    const pricing=url.searchParams.get("costMode")==="estimated" ? await loadApiPrices() : null;
    const details=getAccountModelUsage(ownerId,providerId,modelId,range.from,range.to,pricing);
    return details ? Response.json({details},{headers}) : Response.json({error:"No recorded usage for this model in this period."},{status:404,headers});
  }
  const excludedProviders=url.searchParams.getAll("excludeProvider");
  if(excludedProviders.length>100 || excludedProviders.some(id=>!id || id.length>128))
    return Response.json({error:"Choose valid provider filters."},{status:400,headers});
  const pricing=url.searchParams.get("costMode")==="estimated" ? await loadApiPrices() : null;
  return Response.json({usage:getAccountUsage(ownerId,range.from,range.to,pricing,excludedProviders)},{headers});
}
