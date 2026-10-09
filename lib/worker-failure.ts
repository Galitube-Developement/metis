import { getJob } from "@/lib/db-jobs";
import { appendMessage } from "@/lib/db-store";
import { transaction } from "@/lib/sqlite";

/**
 * Called by the supervising worker after it has committed the failed job.
 * The child may no longer hold a writer lease. Never deduplicate against
 * unrelated messages: the same failure can recur in a later run.
 */
export function persistWorkerFailureMessage(jobId: string, message: string) {
  return transaction(() => {
    const job = getJob(jobId);
    if (!job || job.status !== "error") return null;
    return appendMessage(job.chatId, {
      id: `worker-error:${job.id}:${job.attempts}`,
      role: "assistant",
      content: "",
      errorMessage: message,
    }, job.userId);
  });
}
