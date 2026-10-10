"use client";
import { useSyncExternalStore } from "react";
import type { UsageCostMode } from "@/lib/usage-cost-view";
const KEY="metis-usage-cost-mode", EVENT="metis-usage-cost-mode-change";
function subscribe(callback:()=>void) {
  window.addEventListener("storage",callback);window.addEventListener(EVENT,callback);
  return ()=>{window.removeEventListener("storage",callback);window.removeEventListener(EVENT,callback);};
}
function read(): UsageCostMode {
  try {const value=localStorage.getItem(KEY);if(value==="reported" || value==="hidden")return value;} catch {}
  return "estimated";
}
export function useUsageCostMode() {
  const mode=useSyncExternalStore(subscribe,read,()=>"estimated" as UsageCostMode);
  function setMode(value: UsageCostMode) {
    try {localStorage.setItem(KEY,value);} catch {}
    window.dispatchEvent(new Event(EVENT));
  }
  return [mode,setMode] as const;
}
