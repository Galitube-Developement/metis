"use client";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Download, RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ProviderLogo } from "@/components/provider-logo";
import { ModelUsageDetails } from "@/components/account/model-usage-details";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccountUsage, UsageModel } from "@/lib/account-types";
import { usageCsv } from "@/lib/account-usage-export";
const compact=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1});
const money=new Intl.NumberFormat("en",{style:"currency",currency:"USD",maximumFractionDigits:4});
const format=(value:number|null,cost=false)=>value===null?"—":cost?money.format(value):value.toLocaleString();

export function UsageDashboard() {
  const [range,setRange]=useState("30");
  const [from,setFrom]=useState(""),[to,setTo]=useState("");
  const [metric,setMetric]=useState<"costUsd"|"tokens"|"requests">("tokens");
  const [usage,setUsage]=useState<AccountUsage|null>(null);
  const [error,setError]=useState(""),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [sort,setSort]=useState<"tokens"|"costUsd"|"requests"|"modelId">("tokens"),[ascending,setAscending]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const id=useId().replaceAll(":","");
  useEffect(()=>{
    if(range==="custom" && (!from || !to)) { setUsage(null);setLoading(false);return; }
    const controller=new AbortController();
    setLoading(true);setError("");setUsage(null);
    const end=range==="custom"?to:new Date().toISOString().slice(0,10);
    const start=range==="custom"?from:new Date(Date.parse(end)-(Number(range)-1)*86400000).toISOString().slice(0,10);
    const query=new URLSearchParams({from:start,to:end});
    void fetch("/api/account-usage?"+query,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error || "Could not load usage");
      setUsage(data.usage);
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[range,from,to,refresh]);
  const models=useMemo(()=>[...(usage?.models || [])].sort((a,b)=>{
    const value=sort==="modelId"?a.modelId.localeCompare(b.modelId):(a[sort]??-1)-(b[sort]??-1);
    return ascending?value:-value;
  }),[usage,sort,ascending]);
  function exportCsv() {
    if(!usage)return;
    const text=usageCsv(models);
    const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download="metis-usage-"+usage.from+"-"+usage.to+".csv";anchor.click();URL.revokeObjectURL(url);
  }
  function sortBy(key:typeof sort){if(key===sort)setAscending(!ascending);else{setSort(key);setAscending(key==="modelId");}}
  const totals=usage?.totals;
  return <div className="space-y-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Usage</h1><p className="mt-2 text-sm text-muted-foreground">Your activity across models, in one place.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={id+"range"}>Usage date range</label>
        <select id={id+"range"} aria-label="Usage date range" value={range} onChange={e=>{if(e.target.value==="custom"){setFrom(usage?.from || new Date(Date.now()-29*86400000).toISOString().slice(0,10));setTo(usage?.to || new Date().toISOString().slice(0,10));}setRange(e.target.value);}} className="h-11 rounded-lg border border-border bg-background px-3 text-sm">
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option><option value="custom">Custom range</option>
        </select>
        <Button variant="outline" size="icon" className="size-11" aria-label="Refresh usage" onClick={()=>setRefresh(n=>n+1)} disabled={loading}><RefreshCw className={loading?"size-4 animate-spin":"size-4"} /></Button>
      </div>
    </div>
    {range==="custom" ? <div className="flex flex-wrap gap-3"><label className="space-y-1 text-xs text-muted-foreground">From<Input type="date" aria-label="Usage from" value={from} onChange={e=>setFrom(e.target.value)} className="h-11" /></label><label className="space-y-1 text-xs text-muted-foreground">To<Input type="date" aria-label="Usage to" value={to} onChange={e=>setTo(e.target.value)} className="h-11" /></label></div>:null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>:null}
    <section aria-label="Usage overview" aria-busy={loading} className="rounded-xl border border-border/60">
      <div className="flex flex-wrap gap-1 border-b border-border/60 px-4 sm:px-6">
        {([["costUsd","Cost"],["tokens","Tokens"],["requests","Requests"]] as const).map(([key,label])=><button key={key} type="button" aria-pressed={metric===key} onClick={()=>setMetric(key)}
          className={"min-h-12 border-b-2 px-4 text-sm transition-colors "+(metric===key?"border-primary text-foreground":"border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div>
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[210px_1fr]">
        <div><p className="text-xs text-muted-foreground">{metric==="costUsd"?"Reported cost":metric==="tokens"?"Reported tokens":"Requests"}</p>
          <p className="mt-3 break-words text-3xl font-medium tracking-tight tabular-nums sm:text-4xl">{totals ? format(metric==="tokens" && !totals.tokenReports ? null:totals[metric],metric==="costUsd"):loading?"…":"—"}</p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{usage?.from} — {usage?.to}<br />Daily totals · UTC</p>
          {metric==="costUsd" && totals?.costReports===0 ? <p className="mt-4 text-xs text-muted-foreground">Your providers have not reported costs for these runs.</p>:null}
        </div>
        <div className="h-60 min-w-0" aria-label={"Daily "+metric+" chart"}>
          {usage && !error ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={usage.days.map(day=>({...day,tokens:day.requests && !day.tokenReports ? null:day.tokens,costUsd:day.requests?day.costUsd:0}))} margin={{top:8,right:8,bottom:0,left:0}}>
              <defs><linearGradient id={id+"fill"} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.16}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 5" opacity={0.6}/>
              <XAxis dataKey="date" tickFormatter={date=>new Date(date).toLocaleDateString("en",{month:"short",day:"numeric",timeZone:"UTC"})} minTickGap={36} tick={{fill:"var(--muted-foreground)",fontSize:11}} tickLine={false} axisLine={false} />
              <YAxis width={48} tickFormatter={n=>metric==="costUsd"?"$"+compact.format(n):compact.format(n)} tick={{fill:"var(--muted-foreground)",fontSize:11}} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{background:"var(--popover)",border:"1px solid var(--border)",borderRadius:8,color:"var(--foreground)",fontSize:12}} formatter={value=>[format(Number(value),metric==="costUsd"),metric==="costUsd"?"Reported cost":metric==="tokens"?"Tokens":"Requests"]}/>
              <Area type="monotone" dataKey={metric} stroke="var(--chart-1)" strokeWidth={1.8} fill={"url(#"+id+"fill)"} isAnimationActive={false} connectNulls={false}/>
            </AreaChart>
          </ResponsiveContainer>:<div className="flex h-full items-center justify-center text-sm text-muted-foreground">{loading?"Loading usage…":"Usage unavailable"}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5 border-t border-border/60 p-5 sm:grid-cols-4 sm:p-6">
        {([["Requests",totals?.requests],["Input tokens",totals?.inputReports?totals.inputTokens:null],["Output tokens",totals?.outputReports?totals.outputTokens:null],["Reported cost",totals?.costUsd]] as const).map(([label,value])=><div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg tabular-nums">{format(value??null,label==="Reported cost")}</p></div>)}
      </div>
    </section>
    <section aria-label="Usage by model">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-medium">By model</h2><Button variant="outline" className="h-11 gap-2" onClick={exportCsv} disabled={!models.length || Boolean(error) || loading}><Download className="size-4" /> Export CSV</Button></div>
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full table-fixed text-left text-sm"><caption className="sr-only">Model usage for the selected date range</caption>
          <thead className="border-b border-border/60 bg-muted/25 text-xs text-muted-foreground"><tr>
            {([["modelId","Model"],["costUsd","Cost"],["tokens","Tokens"],["requests","Requests"]] as const).map(([key,label])=><th key={key} scope="col" aria-sort={sort===key?(ascending?"ascending":"descending"):"none"} className={"px-3 py-2 font-normal sm:px-4 "+(key==="costUsd"?"hidden sm:table-cell":key==="modelId"?"w-[48%] sm:w-[35%]":"")}>
              <button type="button" className="flex min-h-9 items-center gap-1.5" onClick={()=>sortBy(key)}>{label}{sort===key?(ascending?<ArrowUp className="size-3" />:<ArrowDown className="size-3" />):null}</button></th>)}
            <th className="hidden px-4 py-4 font-normal lg:table-cell" scope="col">Input</th><th className="hidden px-4 py-4 font-normal lg:table-cell" scope="col">Output</th>
          </tr></thead>
          <tbody>{models.map((model:UsageModel)=>{
            const key=JSON.stringify([model.providerId,model.modelId]),open=expanded===key;
            const detailId=id+"-model-"+encodeURIComponent(key);
            return <Fragment key={key}><tr className="border-b border-border/40">
              <td className="max-w-0 px-3 py-2 sm:px-4">
                <button type="button" aria-label={(open?"Hide":"Show")+" usage details for "+model.modelId+" ("+model.providerId+")"} aria-expanded={open} aria-controls={detailId} onClick={()=>setExpanded(open?null:key)} className="flex min-h-12 w-full items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring">
                  <ChevronDown aria-hidden="true" className={"size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none "+(open?"rotate-180":"")}/>
                  <span className="min-w-0"><span className="block truncate font-medium" title={model.modelId}>{model.modelId}</span><span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true"><ProviderLogo providerId={model.providerId} className="size-3.5"/></span><span className="truncate">{model.providerId}</span></span></span>
                </button>
              </td>
              <td className="hidden whitespace-nowrap px-4 py-4 tabular-nums sm:table-cell">{format(model.costUsd,true)}</td>
              <td className="px-3 py-4 tabular-nums sm:px-4">{model.tokenReports?compact.format(model.tokens):"—"}</td>
              <td className="px-3 py-4 tabular-nums sm:px-4">{compact.format(model.requests)}</td>
              <td className="hidden px-4 py-4 tabular-nums lg:table-cell">{format(model.inputReports?model.inputTokens:null)}</td><td className="hidden px-4 py-4 tabular-nums lg:table-cell">{format(model.outputReports?model.outputTokens:null)}</td>
            </tr><tr id={detailId} hidden={!open} className="border-b border-border/40 last:border-b-0"><td colSpan={6} className="bg-muted/15 px-4 py-5 sm:px-6">
              {open && usage ? <ModelUsageDetails key={key+usage.from+usage.to+refresh} model={model} from={usage.from} to={usage.to}/>:null}
            </td></tr></Fragment>;
          })}
          {!models.length ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{loading?"Loading…":"No recorded usage in this period."}</td></tr>:null}
          </tbody>
        </table>
      </div>
    </section>
    <p className="text-xs leading-relaxed text-muted-foreground">Only activity recorded in Metis is included. Requests count completed Metis runs, including project agents and subagents.
      {totals?.requests ? " Tokens reported for "+totals.tokenReports+" of "+totals.requests+" runs; costs reported for "+totals.costReports+" of "+totals.requests+" runs.":""} Missing provider values are not estimated.</p>
  </div>;
}
