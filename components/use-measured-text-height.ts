"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Re-measure after content changes and wrapping; disconnect when the component unmounts. */
export function useMeasuredTextHeight<T extends HTMLElement>(content: string, minimum = 16) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(minimum);
  useLayoutEffect(() => {
    const text = ref.current;
    if (!text) return;
    const measure = () => setHeight(Math.max(minimum, text.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [content, minimum]);
  return [ref, height] as const;
}
