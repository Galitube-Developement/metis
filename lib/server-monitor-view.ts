import { METRIC_INTERVAL_MS, recentMetrics, type ServerMetric } from "./server-metrics-history";
export type MonitorRange = 1 | 5 | 15;
export type MonitorRow = { time: number; metric: ServerMetric | null };

export function monitorRows(history: ServerMetric[], minutes: MonitorRange, now: number): MonitorRow[] {
  const rows: MonitorRow[] = [];
  for (const metric of recentMetrics(history, now, minutes * 60_000)) {
    const time = Date.parse(metric.timestamp);
    const previous = rows.at(-1);
    if (previous && time - previous.time > METRIC_INTERVAL_MS * 3) {
      rows.push({ time: previous.time + METRIC_INTERVAL_MS, metric: null });
    }
    rows.push({ time, metric });
  }
  return rows;
}
export function ramPercent(metric: ServerMetric) {
  return metric.ramTotalBytes > 0 ? metric.ramUsedBytes / metric.ramTotalBytes * 100 : null;
}
