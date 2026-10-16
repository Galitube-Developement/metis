"use client";
import { useState, type ReactNode } from "react";
import { STREAM_FADE_MS } from "@/lib/streaming-text";

/** Keep the birth time across rerenders; remounts resume an unfinished fade only. */
export function ArrivalFade({ bornAt, children }: { bornAt?: number; children: ReactNode }) {
  const [delay] = useState(() => {
    const age = bornAt === undefined ? STREAM_FADE_MS : Math.max(0, Date.now() - bornAt);
    return age < STREAM_FADE_MS ? age : null;
  });
  return <div className={delay === null ? undefined : "stream-token-fade"}
    style={delay === null || delay === 0 ? undefined : { animationDelay: "-" + delay + "ms" }}>{children}</div>;
}
