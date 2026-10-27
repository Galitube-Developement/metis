import { isAuthenticated } from "@/lib/auth";
import { submitChatOffThread } from "@/lib/chat-page-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  // Read-only session validation. All submission reads/writes run off-thread.
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const response = await submitChatOffThread({
      url: req.url, headers: Array.from(req.headers.entries()), body: await req.text(),
    });
    return new Response(response.body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  } catch {
    // Never run a synchronous fallback or log request data/cookies.
    return Response.json({ error: "Message submission is busy. Retry shortly." }, {
      status: 503, headers: { "Retry-After": "1" },
    });
  }
}
