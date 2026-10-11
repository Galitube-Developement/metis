"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "./use-chart-motion";

const formats = {
  integer: new Intl.NumberFormat("en"),
  compact: new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }),
  money: new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 4 }),
};

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

/** Keep the last settled value during refresh; unknown values remain unknown. */
export function AnimatedNumber({ value, loading = false, format = "integer" }: {
  value: number | null | undefined; loading?: boolean; format?: keyof typeof formats;
}) {
  const reduced = useReducedMotion();
  const valid = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [settled, setSettled] = useState(valid);
  if (!loading && settled !== valid) setSettled(valid);
  const shown = loading ? settled : valid;
  if (shown === null) return <span>{loading ? "…" : "—"}</span>;
  const text = formats[format].format(shown);
  const digits = text.replace(/\D/g, "").length;
  let position = digits;
  return <span className="number-ticker" data-number-value={shown}>
    <span className="sr-only">{text}</span>
    <span aria-hidden="true" className="number-ticker-visual">{Array.from(text).map((character, index) =>
      /[0-9]/.test(character) ? <Digit key={"digit-" + --position} value={Number(character)} reduced={reduced}/> : <span key={"separator-" + index}>{character}</span>
    )}</span>
  </span>;
}
