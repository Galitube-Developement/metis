"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** The trailer's round characters: a diagonal shade change and two little eyes. */
export function TeamAgentAvatar({ color, name, className, decorative = false, animated = false }: { color: string; name: string; className?: string; decorative?: boolean; animated?: boolean }) {
 const id = useId().replace(/:/g, "");
 const variation = Array.from(name).reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
 const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : "#2563eb";
 return <svg viewBox="0 0 48 48" role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : name} className={cn("size-9 shrink-0", className)}>
  <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor={safeColor}/><stop offset="1" stopColor={safeColor}/></linearGradient>
   <linearGradient id={id + "-light"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#000" stopOpacity=".07"/><stop offset="1" stopColor="#fff" stopOpacity=".24"/></linearGradient>
  </defs>
  <circle cx="24" cy="24" r="23" fill={`url(#${id})`}/>
  <circle cx="24" cy="24" r="23" fill={`url(#${id}-light)`}/>
  <g className={cn("team-agent-eyes", animated && "team-agent-eyes-active")} style={animated ? { animationDuration: `${6 + variation % 3}s`, animationDelay: `-${(variation % 5) * 0.12}s` } : undefined}>
  <rect x="16" y="23" width="5.4" height="11" rx="1.2" fill="#101318"/>
  <rect x="28" y="23" width="5.4" height="11" rx="1.2" fill="#101318"/>
  </g>
 </svg>;
}
