export type InstallerJobPoll = {
  status: "preparing" | "ready" | "failed" | "restarting";
  error?: string;
  tag?: string;
};

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
    return { status: "ready" };
  }
  if (!response.ok) {
    return { status: "failed", error: job.error || `Could not restore update status (HTTP ${response.status}).` };
  }
  if (job.status === "ready") return { status: "ready", tag: job.result?.tag };
  if (job.status === "failed") return { status: "failed", error: job.error || "Update preparation failed without a server detail." };
  return { status: "preparing" };
}
