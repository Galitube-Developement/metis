/** Start telemetry with the app, including when no monitor tab has ever opened. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startServerMetrics } = await import("./lib/server-metrics");
    await startServerMetrics();
  }
}
