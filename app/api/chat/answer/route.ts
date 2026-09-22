import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { questionLimits, resolveQuestion } from "@/lib/db-questions";
import { getJob, updateJob } from "@/lib/db-jobs";
import { shouldQueueUserInputResume } from "@/lib/user-input-resume";
import { getChat, updateChat } from "@/lib/db-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { questionId?: unknown; answers?: unknown; version?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const answers = Array.isArray(body.answers)
    ? body.answers.filter((answer): answer is string => typeof answer === "string")
    : [];
  const version = typeof body.version === "number" && Number.isFinite(body.version)
    ? Math.floor(body.version)
    : undefined;
  const { maxQuestions, maxAnswerLength } = questionLimits();
  if (
    !questionId ||
    answers.length === 0 ||
    answers.length > maxQuestions ||
    answers.some((answer) => !answer.trim() || answer.length > maxAnswerLength)
  ) {
    return Response.json({ error: "Invalid question answers" }, { status: 400 });
  }
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const resolved = resolveQuestion(questionId, answers, userId, version);
  if (!resolved) {
    return Response.json(
      { error: "Question not found or already answered" },
      { status: 404 },
    );
  }
  const resolvedJob = resolved.jobId ? getJob(resolved.jobId) : null;
  if (
    resolved.jobId &&
    shouldQueueUserInputResume(resolvedJob?.status, resolved.heartbeatAt)
  ) {
    updateJob(resolved.jobId, {
      status: "queued",
      error: undefined,
      resumePrompt: `The user answered the pending question with: ${JSON.stringify(resolved.answers)}`,
      resumeRequestedAt: new Date().toISOString(),
    });
  }
  // Release the durable UI state immediately. The MCP request will observe
  // the answer independently and continue the agent run.
  const currentChat = getChat(resolved.chatId, userId);
  if (currentChat?.pendingQuestion?.questionId === questionId) {
    updateChat(
      resolved.chatId,
      { runStatus: "running", pendingQuestion: null, badge: null },
      userId,
    );
  }
  return Response.json({
    ok: true,
    questionId,
    jobId: resolved.jobId,
    runId: resolved.runId,
    version: resolved.version,
    status: resolved.status,
  });
}
