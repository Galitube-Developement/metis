export type InstallerJobPoll = {
  status: "preparing" | "ready" | "failed" | "restarting";
  error?: string;
  tag?: string;
};

export type InstallerMaintenanceDetail = {
  active: true;
  reason: string;
  logs: string[];
};

export const UPDATE_JOB_STORAGE_KEY = "metis-update-job";

export const INSTALLER_MAINTENANCE_EVENT = "metis:installer-maintenance";

export function activateInstallerMaintenanceScreen(reason: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<InstallerMaintenanceDetail>(INSTALLER_MAINTENANCE_EVENT, {
    detail: { active: true, reason, logs: ["Update job created."] },
  }));
}

export function installerJobFinishedMessage(tag?: string) {
  return tag && tag !== "latest" && tag !== "master"
    ? `Installer finished (${tag}). Metis is running again.`
    : "Installer finished. Metis is running again.";
}

export async function pollInstallerJob(jobId: string): Promise<InstallerJobPoll> {
  const response = await fetch(`/api/admin/system/update?job=${encodeURIComponent(jobId)}`, { cache: "no-store" });
  const job = (await response.json().catch(() => ({}))) as {
    status?: string;
    error?: string;
    result?: { tag?: string };
  };
  if (response.status === 404) {
    const maintenance = await fetch("/api/system/maintenance", { cache: "no-store" })
      .then(async (next) => (await next.json().catch(() => ({}))) as { active?: boolean })
      .catch(() => ({ active: true as const }));
    if (maintenance.active) return { status: "restarting" };
    return {
      status: "failed",
      error: "Metis is running, but this update job could not be verified. Check for updates again before retrying.",
    };
  }
  if (!response.ok) {
    return { status: "failed", error: job.error || `Could not restore update status (HTTP ${response.status}).` };
  }
  if (job.status === "ready") return { status: "ready", tag: job.result?.tag };
  if (job.status === "failed") return { status: "failed", error: job.error || "Update preparation failed without a server detail." };
  return { status: "preparing" };
}

// The maintenance screen and update controls can finish polling together.
// Consume the pending job before navigating so only one of them reloads.
export function reloadCompletedInstallerJob(jobId: string, job: InstallerJobPoll): boolean {
  if (typeof window === "undefined" || job.status !== "ready") return false;
  if (window.localStorage.getItem(UPDATE_JOB_STORAGE_KEY) !== jobId) return false;
  window.localStorage.removeItem(UPDATE_JOB_STORAGE_KEY);
  window.location.reload();
  return true;
}
