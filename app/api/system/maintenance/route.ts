import { config } from "@/lib/config";
import { installerUpdateIsRunning, readInstallerUpdateLog } from "@/lib/installer-update";
import { clearMaintenanceState, readMaintenanceState } from "@/lib/maintenance-state";
import { resolveUpdateJob } from "@/lib/update-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readMaintenanceState();
  if (!state) {
    return Response.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const job = await resolveUpdateJob(state.jobId);
  if (job?.status === "preparing") {
    return Response.json({ ...state, logs: job.logs || [] }, { headers: { "Cache-Control": "no-store" } });
  }

  if (await installerUpdateIsRunning(config.serviceName)) {
    return Response.json({
      ...state,
      logs: await readInstallerUpdateLog(config.dataDir),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  await clearMaintenanceState();
  return Response.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
}
