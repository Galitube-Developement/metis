"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeNotificationPrefs, type NotificationPrefs } from "@/lib/notification-preferences";
export type NotificationClient = { id: string; name: string; status: string; nativeNotifications: boolean | null };
type Patch = Partial<NotificationPrefs> & {remoteClient?:{id:string;enabled:boolean}};
export function useNotificationSettings(active = true) {
  const [prefs,setPrefs] = useState<NotificationPrefs|null>(null),[clients,setClients]=useState<NotificationClient[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const alive=useRef(false),version=useRef(0),saving=useRef(false),controller=useRef<AbortController|null>(null);
  const reload=useCallback(async()=>{
    if(!alive.current || saving.current)return;
    const request=++version.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
    try{
      const response=await fetch("/api/notifications",{cache:"no-store",signal:abort.signal});const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.error||"Could not load notification settings. Try again.");
      if(!data?.prefs || typeof data.prefs !== "object" || !Array.isArray(data.clients) || data.clients.some((c:NotificationClient)=>!c||typeof c.id!=="string"||typeof c.name!=="string"||typeof c.status!=="string"))throw new Error("Incomplete notification settings. Try again.");
      if(alive.current && request===version.current){setPrefs(normalizeNotificationPrefs(data.prefs));setClients(data.clients);setError("");}
    }catch(cause){if(alive.current && !abort.signal.aborted && request===version.current)setError(cause instanceof Error?cause.message:"Could not load notifications.");}
  },[]);
  useEffect(()=>{
    alive.current=active;if(!active)return;
    void reload();const timer=window.setInterval(()=>void reload(),5000);
    return()=>{alive.current=false;version.current++;controller.current?.abort();window.clearInterval(timer)};
  },[active,reload]);
  const save=useCallback(async(patch:Patch)=>{
    if(!alive.current||saving.current)return false;
    saving.current=true;const request=++version.current;controller.current?.abort();setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.error||"Could not save notification settings. Try again.");
      if(!data?.prefs||typeof data.prefs!=="object")throw new Error("Incomplete save response. Try again.");
      if(alive.current && request===version.current){setPrefs(normalizeNotificationPrefs(data.prefs));setNotice("Saved.");}return true;
    }catch(cause){if(alive.current&&request===version.current)setError(cause instanceof Error?cause.message:"Could not save notifications.");return false}
    finally{saving.current=false;if(alive.current)setBusy(false)}
  },[]);
  return {prefs,clients,busy,error,notice,reload,save};
}
export type NotificationSettingsState = ReturnType<typeof useNotificationSettings>;
