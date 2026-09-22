import type { JobStatus } from "@/lib/jobs";

export const USER_INPUT_HEARTBEAT_GRACE_MS = 5_000;

const LIVE_USER_INPUT_STATUSES = new Set<JobStatus>([
  "running",
  "waiting_input",
  "waiting_for_user",
]);

export function isJobWaitingForUser(status: JobStatus | undefined) {
  return status === "waiting_input" || status === "waiting_for_user";
}

export function shouldQueueUserInputResume(
  status: JobStatus | undefined,
  heartbeatAt: string | undefined,
  now = Date.now(),
) {
  if (!status) return false;
  if (!LIVE_USER_INPUT_STATUSES.has(status)) return true;
  const heartbeat = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
  return !Number.isFinite(heartbeat) || now - heartbeat > USER_INPUT_HEARTBEAT_GRACE_MS;
}
