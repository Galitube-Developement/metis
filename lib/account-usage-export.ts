import type { UsageModel } from "./account-types";
import { usageCost, usageCostReports, type UsageCostMode } from "./usage-cost-view";
function cell(value:unknown) {
  let text=String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function usageCsv(models:UsageModel[], mode:UsageCostMode="reported") {
  const costs=mode!=="hidden";
  const rows:unknown[][]=[["Model","Provider","Requests (Metis runs)","Input tokens","Output tokens","Total tokens",
    ...(costs?[mode==="estimated"?"Estimated standard API value USD":"Reported cost USD"]:[]),
    "Token reports",...(costs?[mode==="estimated"?"Estimated runs":"Cost reports"]:[]),
    ...(mode==="estimated"?["API price provider","API price model","Input USD / 1M","Output USD / 1M","Cache read USD / 1M","Cache write USD / 1M"]:[])]];
  for(const model of models) rows.push([
    model.modelId,model.providerId,model.requests,
    model.inputReports?model.inputTokens:null,
    model.outputReports?model.outputTokens:null,
    model.tokenReports?model.tokens:null,
    ...(costs?[usageCost(model,mode)]:[]),model.tokenReports,...(costs?[usageCostReports(model,mode)]:[]),
    ...(mode==="estimated"?[model.apiPrice?.providerId,model.apiPrice?.modelId,model.apiPrice?.input,model.apiPrice?.output,model.apiPrice?.cacheRead,model.apiPrice?.cacheWrite]:[]),
  ]);
  return rows.map(row=>row.map(cell).join(",")).join("\r\n");
}
