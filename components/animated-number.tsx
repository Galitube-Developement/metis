"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { reconcileTicker, tickerCharacters, type TickerCharacter } from "@/lib/number-ticker";
import { useReducedMotion } from "./use-chart-motion";

const formats = {
  integer: new Intl.NumberFormat("en"),
  compact: new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }),
  money: new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 4 }),
};
const transitionMs = 650;

function Digit({ value, reduced }: { value: number; reduced: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <span className="number-ticker-digit"><span className="number-ticker-wheel" style={{ transform: `translateY(-${(ready || reduced ? value : 0) * 10}%)`, transitionDuration: reduced ? "0ms" : undefined }}>
    {"0123456789".split("").map(digit => <span key={digit}>{digit}</span>)}
  </span></span>;
}

function Column({ item, enter, reduced }: { item: TickerCharacter; enter: boolean; reduced: boolean }) {
  const content = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  const [ready, setReady] = useState(!enter);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const visible = item.active && (ready || reduced);
  return <span className="number-ticker-column" data-ticker-key={item.key} data-ticker-active={item.active}
    style={{ width: visible ? width : 0, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(-0.12em)", transitionDuration: reduced ? "0ms" : undefined }}>
    <span ref={content} className="number-ticker-column-content">
      {/[0-9]/.test(item.character) ? <Digit value={Number(item.character)} reduced={reduced}/> : item.character}
    </span>
  </span>;
}

/** Retain the last report during refresh and preserve columns across metric switches. */
export function AnimatedNumber({ value, loading = false, format = "integer", valueKey = format }: {
  value: number | null | undefined; loading?: boolean; format?: keyof typeof formats; valueKey?: string;
}) {
  const reduced = useReducedMotion();
  const valid = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [settled, setSettled] = useState({ key: valueKey, value: valid });
  if (!loading && (settled.value !== valid || settled.key !== valueKey)) setSettled({ key: valueKey, value: valid });
  // Refreshes can retain a report, but never reinterpret a different metric's value.
  const shown = loading ? settled.key === valueKey ? settled.value : null : valid;
  const text = shown === null ? "" : formats[format].format(shown);
  const [layout, setLayout] = useState(() => ({ text, reduced, initial: true,
    columns: shown === null ? [] : tickerCharacters(formats[format].formatToParts(shown)) }));
  if (layout.text !== text || layout.reduced !== reduced) {
    const next = shown === null ? [] : tickerCharacters(formats[format].formatToParts(shown));
    setLayout({ text, reduced, initial: false, columns: reconcileTicker(layout.columns, next, reduced) });
  }
  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setLayout(current => {
      const columns = current.columns.filter(item => item.active);
      return columns.length === current.columns.length ? current : { ...current, columns };
    }), transitionMs + 100);
    return () => clearTimeout(timer);
  }, [text, reduced]);
  if (shown === null) return <span>{loading ? "…" : "—"}</span>;
  return <span className="number-ticker" data-number-value={shown}>
    <span className="sr-only">{text}</span>
    <span aria-hidden="true" className="number-ticker-visual">{layout.columns.map(item =>
      <Column key={item.key} item={item} enter={!layout.initial} reduced={reduced}/>
    )}</span>
  </span>;
}
