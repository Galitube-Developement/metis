import type { UsageDay, UsageModel, UsageTotals } from "./account-types";
import { usageCost, usageCostReports, type UsageCostMode } from "./usage-cost-view";
export type UsageMetric = "tokens" | "requests" | "costUsd";
export function usageMetricValue(value: UsageTotals, metric: UsageMetric, mode: UsageCostMode): number|null {
  return metric==="costUsd" ? usageCost(value,mode) : metric==="tokens" && value.requests>0 && !value.tokenReports ? null : value[metric];
}
export function usageModelContributions(day:UsageDay, models:UsageModel[], metric:UsageMetric, mode:UsageCostMode) {
  const total=usageMetricValue(day,metric,mode);
  const reports=metric==="costUsd" ? usageCostReports(day,mode) : metric==="tokens" ? day.tokenReports : day.requests;
  return {total,partial:reports<day.requests,rows:models.map(model=>{
    const value=usageMetricValue(model,metric,mode);
    return {modelId:model.modelId,providerId:model.providerId,value,percentage:value!==null && total!==null && total>0 ? value/total*100 : null};
  }).sort((a,b)=>(b.value??-1)-(a.value??-1) || a.modelId.localeCompare(b.modelId) || a.providerId.localeCompare(b.providerId))};
}
