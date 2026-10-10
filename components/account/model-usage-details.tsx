"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import type { UsageBucket, UsageConfigurationCounts, UsageModel, UsageModelDetails } from "@/lib/account-types";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
type Metric = "tokens" | "requests" | keyof UsageConfigurationCounts;
const labels: Record<Metric,string> = {tokens:"Tokens",requests:"Requests",context:"Context",speed:"Fast mode",reasoning:"Reasoning"};
const colors = ["var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)","var(--chart-5)"];
function bucketLabel(metric: Metric, value: string | null) {
  if(value === null)return "Not recorded";
  if(metric === "context")return compact.format(Number(value));
  if(metric === "speed")return value === "fast" ? "Fast on" : value === "standard" ? "Fast off" : value;
  return value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase()+value.slice(1);
}

function Distribution({dimension,buckets,requests}: {dimension:keyof UsageConfigurationCounts;buckets:UsageBucket[];requests:number}) {
  const known=buckets.filter(bucket=>bucket.value!==null);
  const mostUsed=known.filter(bucket=>bucket.requests===known[0]?.requests).map(bucket=>bucketLabel(dimension,bucket.value)).join(" / ");
  const unknown=buckets.find(bucket=>bucket.value===null)?.requests || 0;
  return <div className="min-w-0">
    <h4 className="text-xs font-medium">{labels[dimension]}</h4>
    {mostUsed ? <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground" title={mostUsed}>Most used: {mostUsed}</p>:null}
    {known.length ? <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
      {known.map(bucket=><li key={bucket.value} className="text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate" title={bucketLabel(dimension,bucket.value)}>{bucketLabel(dimension,bucket.value)}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{bucket.requests.toLocaleString()} · {Math.round(bucket.requests/requests*100)}%</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-foreground/60" style={{width:bucket.requests/requests*100+"%"}} /></div>
      </li>)}
    </ul>:<p className="mt-3 text-xs text-muted-foreground">No recorded settings.</p>}
    {unknown ? <p className="mt-2 text-[11px] text-muted-foreground">{unknown.toLocaleString()} not recorded</p>:null}
  </div>;
}

export function ModelUsageDetails({model,from,to}: {model:UsageModel;from:string;to:string}) {
  const [details,setDetails]=useState<UsageModelDetails|null>(null);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  const [metric,setMetric]=useState<Metric>("tokens");
  const id=useId();
  useEffect(()=>{
    const controller=new AbortController();
    setDetails(null);setError("");
    const query=new URLSearchParams({from,to,modelId:model.modelId,providerId:model.providerId});
    void fetch("/api/account-usage?"+query,{signal:controller.signal,cache:"no-store"})
      .then(async response=>{
        const data=await response.json();
        if(!response.ok)throw new Error(data.error || "Could not load model details.");
        if(!controller.signal.aborted)setDetails(data.details);
      }).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[model.modelId,model.providerId,from,to,retry]);
  const chart=useMemo<{data:Array<Record<string,string|number|null>>;series:Array<{key:string;label:string}>}>(()=>{
    if(!details)return {data:[],series:[]};
    if(metric === "tokens" || metric === "requests")return {
      data:details.days.map(day=>({date:day.date,value:metric==="tokens" && day.requests && !day.tokenReports ? null:day[metric]})),
      series:[{key:"value",label:labels[metric]}],
    };
    const buckets=details.configurations[metric];
    const top=buckets.slice(0,4);
    const series=top.map((bucket,index)=>({key:"bucket"+index,label:bucketLabel(metric,bucket.value)}));
    if(buckets.length>4)series.push({key:"other",label:"Other"});
    return {
      series,
      data:details.days.map(day=>{
        const row:Record<string,string|number>={date:day.date};
        top.forEach((bucket,index)=>{row["bucket"+index]=day.configurations[metric].find(item=>item.value===bucket.value)?.requests || 0;});
        if(buckets.length>4)row.other=day.configurations[metric].filter(bucket=>!top.some(item=>item.value===bucket.value)).reduce((sum,bucket)=>sum+bucket.requests,0);
        return row;
      }),
    };
  },[details,metric]);
  if(error)return <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm"><span className="text-destructive">{error}</span><Button variant="outline" onClick={()=>setRetry(n=>n+1)}>Retry</Button></div>;
  if(!details)return <p role="status" className="py-8 text-sm text-muted-foreground">Loading model details…</p>;
  return <section aria-label={model.modelId+" usage details"} className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-medium">Model activity</h3><p className="mt-1 text-[11px] text-muted-foreground">{from} — {to} · UTC · {details.requests.toLocaleString()} runs</p></div>
      <select aria-label={"Chart metric for "+model.modelId} value={metric} onChange={event=>setMetric(event.target.value as Metric)} className="h-10 max-w-full rounded-lg border border-border bg-background px-3 text-xs">
        {(Object.keys(labels) as Metric[]).map(key=><option key={key} value={key}>{labels[key]}</option>)}
      </select>
    </div>
    <div className="h-44 min-w-0" role="img" aria-label={labels[metric]+" by day for "+model.modelId}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={chart.data} margin={{top:4,right:0,left:0,bottom:0}}>
          <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" opacity={0.5}/>
          <XAxis dataKey="date" tickFormatter={date=>new Date(date).toLocaleDateString("en",{month:"short",day:"numeric",timeZone:"UTC"})} minTickGap={32} tick={{fill:"var(--muted-foreground)",fontSize:10}} tickLine={false} axisLine={false}/>
          <YAxis width={40} allowDecimals={metric==="tokens"} tickFormatter={value=>compact.format(value)} tick={{fill:"var(--muted-foreground)",fontSize:10}} tickLine={false} axisLine={false}/>
          <Tooltip contentStyle={{background:"var(--popover)",border:"1px solid var(--border)",borderRadius:8,fontSize:12,color:"var(--foreground)"}} formatter={value=>Number(value).toLocaleString()} />
          {chart.series.length>1 ? <Legend wrapperStyle={{fontSize:10}} formatter={value=><span className="text-muted-foreground">{value}</span>} iconType="circle" iconSize={6}/>:null}
          {chart.series.map((series,index)=><Bar key={series.key} dataKey={series.key} name={series.label} stackId="usage" fill={colors[index]} maxBarSize={18} isAnimationActive={false}/>)}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="grid gap-5 border-t border-border/50 pt-4 sm:grid-cols-3">
      {(["context","speed","reasoning"] as const).map(dimension=><Distribution key={dimension} dimension={dimension} buckets={details.configurations[dimension]} requests={details.requests}/>)}
    </div>
    <p id={id} className="text-[11px] leading-relaxed text-muted-foreground">Settings count completed runs; percentages include all runs in this period. Context is the configured capacity, not tokens consumed. Missing historical settings stay unreported.</p>
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground sm:hidden">
      <div><dt className="inline">Reported cost </dt><dd className="inline tabular-nums">{details.costUsd===null?"—":new Intl.NumberFormat("en",{style:"currency",currency:"USD",maximumFractionDigits:4}).format(details.costUsd)}</dd></div>
      <div><dt className="inline">Input </dt><dd className="inline tabular-nums">{details.inputReports?compact.format(details.inputTokens):"—"}</dd></div>
      <div><dt className="inline">Output </dt><dd className="inline tabular-nums">{details.outputReports?compact.format(details.outputTokens):"—"}</dd></div>
    </dl>
  </section>;
}
