"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UsageDay } from "@/lib/account-types";
const number=new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1});
export function TokenHeatmap({days}: {days:UsageDay[]}) {
  const scroller=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(scroller.current)scroller.current.scrollLeft=scroller.current.scrollWidth;},[days]);
  const [selected,setSelected]=useState<UsageDay|null>(null);
  const {weeks,max,total,active,labels}=useMemo(()=>{
    if(!days.length) return {weeks:[] as Array<Array<UsageDay|null>>,max:0,total:0,active:0,labels:[] as string[]};
    const padded:Array<UsageDay|null>=Array.from({length:(new Date(days[0].date).getUTCDay()+6)%7},()=>null);
    padded.push(...days);
    const weeks:Array<Array<UsageDay|null>>=[];
    for(let i=0;i<padded.length;i+=7) weeks.push(padded.slice(i,i+7));
    const labels=weeks.map((week,index)=>{
      const first=week.find(Boolean);
      const previous=weeks[index-1]?.find(Boolean);
      return first && first.date.slice(0,7)!==previous?.date.slice(0,7) ? new Date(first.date).toLocaleDateString("en",{month:"short",timeZone:"UTC"}) : "";
    });
    return {weeks,max:Math.max(...days.map(day=>day.tokens),1),total:days.reduce((n,d)=>n+d.tokens,0),active:days.filter(d=>d.tokens>0).length,labels};
  },[days]);
  return <section aria-label="Daily token activity" className="rounded-xl border border-border/60 p-4 sm:p-5">
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
              day ? <button key={day.date} type="button" aria-label={day.date+": "+day.tokens.toLocaleString()+" reported tokens"} title={day.date+": "+day.tokens.toLocaleString()+" tokens"} onClick={()=>setSelected(day)} onFocus={()=>setSelected(day)}
                className="size-[10px] rounded-[2px] bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                style={{opacity:day.tokens===0?0.09:0.25+0.75*Math.sqrt(day.tokens/max)}} /> : <span key={row} />)}</div>)}
          </div>
        </div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <p role="status">{selected ? selected.date+" · "+selected.tokens.toLocaleString()+" reported tokens" : "Daily provider-reported tokens · UTC"}</p>
      <div className="flex items-center gap-1"><span className="mr-1">Less</span>{[0.09,0.25,0.5,0.75,1].map(opacity=><span key={opacity} className="size-2.5 rounded-[2px] bg-primary" style={{opacity}} />)}<span className="ml-1">More</span></div>
    </div>
  </section>;
}
