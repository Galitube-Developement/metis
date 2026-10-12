"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { tokenActivityDetails, type TokenActivityDay } from "@/lib/profile-token-activity";
import type { UsageDay } from "@/lib/account-types";
const number=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1});
const exactNumber=new Intl.NumberFormat("en");
const HeatmapCell=memo(function HeatmapCell({day,usage,max,onSelect}:{day:TokenActivityDay;usage?:UsageDay;max:number;onSelect:(day:TokenActivityDay)=>void}) {
  const [open,setOpen]=useState(false);
  const detail=tokenActivityDetails(day,usage);
  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild>
      <button type="button" data-heatmap-date={day.date}
        aria-label={day.date+": "+(detail.total===null?"Token count unavailable":exactNumber.format(detail.total)+" reported tokens")}
        onClick={event=>{event.preventDefault();onSelect(day);setOpen(true);}}
        onFocus={()=>onSelect(day)}
        className="size-[10px] rounded-[2px] bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        style={{opacity:day.tokens===0?0.09:0.25+0.75*Math.sqrt(day.tokens/max)}}/>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={8} collisionPadding={12}
      className="block w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md motion-reduce:animate-none"
      arrowClassName="bg-popover fill-popover">
      <div className="mb-3 flex items-baseline justify-between gap-3"><span className="font-medium">{detail.date}</span><span className="text-[10px] text-muted-foreground">UTC</span></div>
      <dl className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 tabular-nums">
        <dt className="text-muted-foreground">Total tokens</dt><dd className="text-right font-medium">{detail.total===null?"Not reported":exactNumber.format(detail.total)}</dd>
        {detail.requests!==undefined && <><dt className="text-muted-foreground">Runs</dt><dd className="text-right">{exactNumber.format(detail.requests)}</dd></>}
        {detail.rows.map(row=><div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right">{row.value===null?"Not reported":exactNumber.format(row.value)}
            {row.reports>0 && row.reports<(detail.requests??0) && <span className="mt-0.5 block text-[10px] text-muted-foreground">{row.reports}/{detail.requests} runs</span>}
          </dd></div>)}
      </dl>
      {detail.requests===0 ? <p className="mt-3 text-[10px] text-muted-foreground">No recorded activity.</p> :
        detail.tokenReports!==undefined && <p className="mt-3 text-[10px] text-muted-foreground">Tokens reported for {detail.tokenReports} of {detail.requests} runs{detail.partial?" · Partial total":""}.</p>}
    </TooltipContent>
  </Tooltip>;
});
export function TokenHeatmap({days,detailDays}: {days:TokenActivityDay[];detailDays?:UsageDay[]}) {
  const scroller=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(scroller.current)scroller.current.scrollLeft=scroller.current.scrollWidth;},[days]);
  const [selected,setSelected]=useState<TokenActivityDay|null>(null);
  const selectDay=useCallback((day:TokenActivityDay)=>setSelected(day),[]);
  const detailsByDate=useMemo(()=>new Map(detailDays?.map(day=>[day.date,day])),[detailDays]);
  const {weeks,max,total,active,labels}=useMemo(()=>{
    if(!days.length) return {weeks:[] as Array<Array<TokenActivityDay|null>>,max:0,total:0,active:0,labels:[] as string[]};
    const padded:Array<TokenActivityDay|null>=Array.from({length:(new Date(days[0].date).getUTCDay()+6)%7},()=>null);
    padded.push(...days);
    const weeks:Array<Array<TokenActivityDay|null>>=[];
    for(let i=0;i<padded.length;i+=7) weeks.push(padded.slice(i,i+7));
    const labels=weeks.map((week,index)=>{
      const first=week.find(Boolean);
      const previous=weeks[index-1]?.find(Boolean);
      return first && first.date.slice(0,7)!==previous?.date.slice(0,7) ? new Date(first.date).toLocaleDateString("en",{month:"short",timeZone:"UTC"}) : "";
    });
    return {weeks,max:Math.max(...days.map(day=>day.tokens),1),total:days.reduce((n,d)=>n+d.tokens,0),active:days.filter(d=>d.tokens>0).length,labels};
  },[days]);
  const selectedTotal=selected ? tokenActivityDetails(selected,detailsByDate.get(selected.date)).total : null;
  return <TooltipProvider delayDuration={100} skipDelayDuration={300}><section aria-label="Daily token activity" className="rounded-xl border border-border/60 p-4 sm:p-5">
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-medium">Token activity</h2><span className="text-xs text-muted-foreground">{number.format(total)} reported tokens · {active} active days</span></div>
    <div ref={scroller} className="overflow-x-auto pb-2">
      <div className="w-max min-w-full">
        <div className="mb-2 grid h-4 gap-[2px] pl-7 text-[10px] text-muted-foreground" style={{gridTemplateColumns:"repeat("+weeks.length+", 10px)"}}>
          {labels.map((label,index)=><span className="overflow-visible" key={index}>{label}</span>)}
        </div>
        <div className="flex gap-2">
          <div className="grid h-[82px] w-5 grid-rows-7 gap-[2px] text-[9px] leading-[10px] text-muted-foreground"><span /><span>Tue</span><span /><span>Thu</span><span /><span>Sat</span><span /></div>
          <div className="grid gap-[2px]" style={{gridTemplateColumns:"repeat("+weeks.length+", 10px)"}}>
            {weeks.map((week,index)=><div key={index} className="grid h-[82px] grid-rows-7 gap-[2px]">{week.map((day,row)=>
              day ? <HeatmapCell key={day.date} day={day} usage={detailsByDate.get(day.date)} max={max} onSelect={selectDay}/> : <span key={row} />)}</div>)}
          </div>
        </div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <p role="status">{selected ? selected.date+" · "+(selectedTotal===null?"Token count unavailable":exactNumber.format(selectedTotal)+" reported tokens") : "Daily provider-reported tokens · UTC"}</p>
      <div className="flex items-center gap-1"><span className="mr-1">Less</span>{[0.09,0.25,0.5,0.75,1].map(opacity=><span key={opacity} className="size-2.5 rounded-[2px] bg-primary" style={{opacity}} />)}<span className="ml-1">More</span></div>
    </div>
  </section></TooltipProvider>;
}
