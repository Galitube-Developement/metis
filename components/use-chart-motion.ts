"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
function snapshot() { return window.matchMedia(query).matches; }
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
export function useChartMotion() {
  const reduced = useReducedMotion();
  return { isAnimationActive: !reduced, animationDuration: 650, animationBegin: 0, animationEasing: "ease-out" as const };
}
