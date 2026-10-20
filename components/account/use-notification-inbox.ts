"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useNotificationInbox(enabled:boolean) {
 const [unreadCount,setUnreadCount]=useState(0);
 const requestVersion=useRef(0);
 const refresh=useCallback(async(signal?:AbortSignal)=>{
  if(!enabled)return;
  const version=++requestVersion.current;
  try {
   const response=await fetch("/api/notifications/inbox",{cache:"no-store",signal});
   if(!response.ok)return;
   const body=await response.json();
   if(!signal?.aborted && version===requestVersion.current && Number.isSafeInteger(body.unreadCount)) {
    setUnreadCount(body.unreadCount);
    window.dispatchEvent(new CustomEvent("metis:notification-inbox-updated",{detail:body}));
   }
  } catch { /* Retain the last successful count until the next refresh. */ }
 },[enabled]);
 useEffect(()=>{
  if(!enabled){setUnreadCount(0);return;}
  const controller=new AbortController();
  const requests=requestVersion;
  const update=()=>{if(document.visibilityState!=="hidden")void refresh(controller.signal);};
  update();
  const timer=window.setInterval(update,15000);
  window.addEventListener("focus",update);
  window.addEventListener("metis:notifications-changed",update);
  document.addEventListener("visibilitychange",update);
  return()=>{++requests.current;controller.abort();window.clearInterval(timer);window.removeEventListener("focus",update);window.removeEventListener("metis:notifications-changed",update);document.removeEventListener("visibilitychange",update);};
 },[enabled,refresh]);
 return {unreadCount,refresh};
}
