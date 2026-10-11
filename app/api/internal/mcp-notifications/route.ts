import { bearerTokenMatches } from "@/lib/security";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import { getJob } from "@/lib/db-jobs";
import { createNotification, notificationInput } from "@/lib/notification-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  const ownerId = req.headers.get("x-ai-chat-user-id")?.trim() || "";
  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  if (!bearerTokenMatches(req,process.env.MCP_BEARER_TOKEN) || !ownerId || !chatId || !jobId || !internalRunLeaseAuthorized(req,jobId))
    return Response.json({error:"Unauthorized"},{status:401});
  const job = getJob(jobId);
  if (!job || job.userId !== ownerId || job.chatId !== chatId) return Response.json({error:"Unauthorized"},{status:401});
  try {
    const input = notificationInput.omit({chatId:true}).parse(await req.json());
    return Response.json({notification:createNotification(ownerId,{...input,chatId})},{status:201});
  } catch { return Response.json({error:"Invalid notification"},{status:400}); }
}
