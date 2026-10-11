"use client";
import { subscribeToWindowEvents } from "@/lib/browser-events";
import { useMemo, useSyncExternalStore } from "react";
const KEY="metis-usage-excluded-providers", EVENT="metis-usage-provider-filter-change";
let fallback="[]";
function subscribe(callback:()=>void) {
  return subscribeToWindowEvents(["storage", EVENT], callback);
}
function read() {
  try {return localStorage.getItem(KEY) || fallback;} catch {return fallback;}
}
export function useUsageProviderFilter() {
  const snapshot=useSyncExternalStore(subscribe,read,()=>"[]");
  const excluded=useMemo<string[]>(()=>{
    try {const values=JSON.parse(snapshot);return Array.isArray(values) ? [...new Set(values.filter((value):value is string=>typeof value==="string" && value.length>0 && value.length<=128))].slice(0,100):[];} catch {return [];}
  },[snapshot]);
  function setExcluded(values:string[]) {
    fallback=JSON.stringify([...new Set(values)]);
    try {localStorage.setItem(KEY,fallback);} catch {}
    window.dispatchEvent(new Event(EVENT));
  }
  return [excluded,setExcluded] as const;
}
