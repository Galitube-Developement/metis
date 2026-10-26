import { setTimeout as delay } from "node:timers/promises";
import { appendRunEvent, getJob, touchJob, updateJob } from "@/lib/db-jobs";
import type { AgentJob } from "@/lib/jobs";
import { getProviderRetryEnabled } from "@/lib/provider-retry-settings";
import { isTransientProviderError, MAX_PROVIDER_RETRIES, providerRetryDetail, type ProviderRetryPart } from "@/lib/provider-retry";
import { transaction } from "@/lib/sqlite";
import { providerContinuationPrompt } from "@/lib/provider-continuation";

/** Publish/checkpoint the retry while retaining the same worker lease and runtime budget. */
export function requestProviderRetry(
  jobId: string,
  error: unknown,
  checkpoint: (event: ProviderRetryPart) => void,
): boolean {
  if (!isTransientProviderError(error)) return false;
  return transaction(() => {
    const current = getJob(jobId);
    if (!current || current.status !== "running" || !getProviderRetryEnabled(current.userId)) return false;
    const count = current.providerRetryCount ?? 0;
    if (!Number.isInteger(count) || count < 0 || count >= MAX_PROVIDER_RETRIES) return false;
    const attempt = count + 1;
    const event: ProviderRetryPart = {
      type: "provider-retry", id: `provider-retry:${current.id}:${attempt}`,
      attempt, maxRetries: MAX_PROVIDER_RETRIES,
      message: `Error occurred, continuing… (${attempt}/${MAX_PROVIDER_RETRIES})`,
      detail: providerRetryDetail(error),
    };
    const updated = updateJob(jobId, {
      providerRetryCount: attempt,
      resumePrompt: providerContinuationPrompt(current, "A transient provider error interrupted this same run."),
      resumeRequestedAt: new Date().toISOString(),
    }, { expectedRevision: current.revision ?? 0 });
    if (!updated) return false;
    checkpoint(event);
    appendRunEvent(current.id, current.chatId, current.userId, "status", {
      ...event, status: "retrying_provider",
    });
    return true;
  });
}

async function waitForProviderRetry(job: AgentJob): Promise<AgentJob | null> {
  // This is Metis recovery backoff, never an assumed provider usage/reset window.
  const delayMs = 1000 * 2 ** ((job.providerRetryCount ?? 1) - 1);
  for (let remaining = delayMs; remaining > 0; remaining -= 250) {
    const current = touchJob(job.id);
    if (!current || current.status !== "running") return null;
    await delay(Math.min(250, remaining));
  }
  const current = touchJob(job.id);
  return current?.status === "running" ? current : null;
}

/** Start another attempt only after cleanup and a bounded, cancellable backoff. */
export async function runWithProviderRetries<T>(
  initialJob: AgentJob,
  runAttempt: (job: AgentJob) => Promise<T>,
): Promise<T> {
  let job = initialJob;
  for (;;) {
    const result = await runAttempt(job);
    const current = getJob(job.id);
    if (!current || current.status !== "running"
      || (current.providerRetryCount ?? 0) <= (job.providerRetryCount ?? 0)) return result;
    const ready = await waitForProviderRetry(current);
    if (!ready) return result;
    job = ready;
  }
}
