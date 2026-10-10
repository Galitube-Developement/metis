import type { UsageModel } from "./account-types";
function cell(value:unknown) {
  let text=String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function usageCsv(models:UsageModel[]) {
  const rows:unknown[][]=[["Model","Provider","Requests (Metis runs)","Input tokens","Output tokens","Total tokens","Reported cost USD","Token reports","Cost reports"]];
  for(const model of models) rows.push([
    model.modelId,model.providerId,model.requests,
    model.inputReports?model.inputTokens:null,
    model.outputReports?model.outputTokens:null,
    model.tokenReports?model.tokens:null,
    model.costUsd,model.tokenReports,model.costReports,
  ]);
  return rows.map(row=>row.map(cell).join(",")).join("\r\n");
}
