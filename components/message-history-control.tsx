"use client";
import { useEffect, useRef, useState } from "react";
export function MessageHistoryControl<T>({url,label,onLoad}:{url?:string;label:string;onLoad:(value:T)=>void}) {
 const [loading,setLoading]=useState(false),[error,setError]=useState(false);
 const request=useRef<AbortController|null>(null);
 useEffect(()=>{
  setLoading(false);setError(false);
  return()=>{request.current?.abort();request.current=null;};
 },[url]);
 if(!url)return null;
 return <button type="button" className="my-2 block text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-60" disabled={loading}
  onClick={async()=>{
   if(request.current)return;
   const controller=new AbortController();request.current=controller;setLoading(true);setError(false);
   try{
    const response=await fetch(url,{cache:"no-store",signal:controller.signal});
    if(!response.ok)throw new Error("History unavailable");
    const body=await response.json();
    if(!controller.signal.aborted)onLoad((body.message || body) as T);
   }catch{if(!controller.signal.aborted)setError(true);}
   finally{if(request.current===controller){request.current=null;if(!controller.signal.aborted)setLoading(false);}}
  }}>{loading?"Loading…":error?"Could not load history · Retry":label}</button>;
}
