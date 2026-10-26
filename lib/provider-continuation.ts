import type { AgentJob } from "@/lib/jobs";

const marker = "[Metis run continuation]";
const contextHeading = "\n\nSaved task context:\n";

/** A pre-accept failure can leave no native session/history containing this task. */
export function providerContinuationPrompt(
  job: Pick<AgentJob, "message" | "resumePrompt">,
  reason: string,
): string {
  const previous = job.resumePrompt?.trim();
  const contextAt = previous?.startsWith(marker) ? previous.indexOf(contextHeading) : -1;
  const savedContext = previous && contextAt >= marker.length
    ? previous.slice(contextAt + contextHeading.length)
    : [
      `Original task (context for unfinished work):\n${job.message || "(see original attachments)"}`,
      previous ? `Previous continuation context or supplied user answer:\n${previous}` : "",
    ].filter(Boolean).join("\n\n");
  return [
    marker,
    reason,
    "Continue only unfinished work from the saved provider session and durable checkpoint. Do not repeat completed tools, side effects or user-facing work. If the provider failed before accepting the task, use the original task below.",
  ].join("\n") + contextHeading + savedContext;
}
