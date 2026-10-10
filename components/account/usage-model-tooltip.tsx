"use client";
import type { UsageDay, UsageModel } from "@/lib/account-types";
import { ProviderLogo } from "@/components/provider-logo";
import { usageModelContributions, type UsageMetric } from "@/lib/usage-model-contributions";
import { usageCostLabel, type UsageCostMode } from "@/lib/usage-cost-view";
const number=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1});
const money=new Intl.NumberFormat("en",{style:"currency",currency:"USD",maximumFractionDigits:4});
const percent=new Intl.NumberFormat("en",{maximumFractionDigits:1});
const share=(value:number|null)=>value===null ? "—" : value>0 && value<0.1 ? "<0.1%" : percent.format(value)+"%";
export function UsageModelTooltip({active,day,models,metric,costMode}:{
  active?:boolean;day?:UsageDay;models:UsageModel[];metric:UsageMetric;costMode:UsageCostMode;
}) {
  if(!active || !day)return null;
  const {total,partial,rows}=usageModelContributions(day,models,metric,costMode);
  const label=metric==="costUsd" ? usageCostLabel(costMode) : metric==="tokens" ? "Tokens" : "Requests";
  const format=(value:number|null)=>value===null ? "—" : metric==="costUsd" ? money.format(value) : number.format(value);
  return <div role="tooltip" aria-label="Daily model contributions" className="w-80 max-w-[calc(100vw-4rem)] rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{day.date} · UTC</span><span className="font-medium tabular-nums">{format(total)}</span></div>
    <div className="mt-3 flex justify-between gap-3 border-b border-border pb-2 text-[11px] text-muted-foreground"><span>{label} by model</span><span>Share of day</span></div>
    {rows.length ? <ul className="max-h-48 space-y-3 overflow-y-auto py-3">{rows.map(row=><li key={JSON.stringify([row.providerId,row.modelId])} className="flex items-center gap-2">
      <span aria-hidden="true" className="shrink-0"><ProviderLogo providerId={row.providerId} className="size-4"/></span>
      <span className="min-w-0 flex-1"><span className="block break-words font-medium">{row.modelId}</span><span className="mt-0.5 block break-all text-[10px] text-muted-foreground">{row.providerId}</span></span>
      <span className="shrink-0 text-right tabular-nums" title={row.value===null ? "Not reported" : String(row.value)}><span className="block">{share(row.percentage)}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{format(row.value)}</span></span>
    </li>)}</ul> : <p className="py-3 text-muted-foreground">{day.requests ? "Model breakdown unavailable." : "No activity on this day."}</p>}
    {partial ? <p className="border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">Shares use recorded {metric==="costUsd" ? costMode==="estimated" ? "estimates" : "costs" : "tokens"} only. Missing values stay unavailable.</p>:total===0 && rows.length ? <p className="border-t border-border pt-2 text-[10px] text-muted-foreground">No percentage for a zero total.</p>:null}
  </div>;
}
