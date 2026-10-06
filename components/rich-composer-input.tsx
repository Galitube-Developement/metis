"use client";

import {
  forwardRef,
  useLayoutEffect,
  useCallback,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { shouldSyncComposerDom, stripComposerPlaceholderLeak } from "@/lib/composer-send";
import { cn } from "@/lib/utils";

const MAX_COMPOSER_HEIGHT = 180;
const MIN_COMPOSER_HEIGHT = 36;

type RichComposerInputProps = {
  value: string;
  mentionLabels?: string[];
  syncNonce?: number;
  onChange: (value: string, cursorPosition: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

export function composerPlainText(element: HTMLElement | null | undefined, placeholder?: string) {
  if (!element) return "";
  const raw =
    element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? element.value
      : (element.textContent || "").replace(/\u00a0/g, " ");
  return stripComposerPlaceholderLeak(raw.replace(/\u00a0/g, " "), placeholder);
}

function fitComposerHeight(element: HTMLTextAreaElement) {
  const scrollTop = element.scrollTop;
  element.style.height = "auto";
  const fullHeight = element.scrollHeight;
  element.style.height = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, fullHeight)) + "px";
  element.style.overflowY = fullHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  element.scrollTop = scrollTop;
}

export const RichComposerInput = forwardRef<HTMLTextAreaElement, RichComposerInputProps>(
  function RichComposerInput(
    {
      value,
      syncNonce,
      onChange,
      onKeyDown,
      onPaste,
      onFocus,
      onBlur,
      placeholder,
      className,
      disabled,
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const lastSyncNonceRef = useRef(syncNonce ?? 0);
    const liveValue = stripComposerPlaceholderLeak(value, placeholder);
    const initialValueRef = useRef(liveValue);
    const attachEditor = useCallback((node: HTMLTextAreaElement | null) => {
      editorRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
      if (node) fitComposerHeight(node);
    }, [ref]);

    useLayoutEffect(() => {
      const element = editorRef.current;
      if (!element) return;
      const nonceChanged = syncNonce !== undefined && syncNonce !== lastSyncNonceRef.current;
      if (nonceChanged) lastSyncNonceRef.current = syncNonce;
      const focused = document.activeElement === element;
      if (!nonceChanged && focused) return;
      if (!shouldSyncComposerDom(element.value, liveValue, focused, nonceChanged)) return;
      element.value = liveValue;
      if (nonceChanged) {
        const cursor = liveValue.length;
        if (liveValue === "") element.focus();
        if (liveValue === "" || focused) element.setSelectionRange(cursor, cursor);
        element.scrollTop = element.scrollHeight;
      }
      fitComposerHeight(element);
    }, [liveValue, syncNonce]);

    return (
      <textarea
        ref={attachEditor}
        defaultValue={initialValueRef.current}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        aria-label={ariaLabel}
        className={cn(
          "rich-composer-input block min-h-9 max-h-[180px] w-full flex-1 resize-none overflow-y-auto whitespace-pre-wrap rounded-none border-0 bg-transparent px-3 py-1.5 text-[15px] leading-6 shadow-none outline-none",
          "placeholder:select-none placeholder:text-muted-foreground",
          "focus-visible:ring-0",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        onChange={(event) => {
          const element = event.currentTarget;
          const next = stripComposerPlaceholderLeak(element.value, placeholder);
          fitComposerHeight(element);
          onChange(next, element.selectionStart ?? next.length);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  },
);
