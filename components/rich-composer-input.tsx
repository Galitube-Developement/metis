"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { shouldSyncComposerDom } from "@/lib/composer-send";
import { cn } from "@/lib/utils";

type RichComposerInputProps = {
  value: string;
  mentionLabels?: string[];
  onChange: (value: string, cursorPosition: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkPattern(mentionLabels: string[]) {
  const mentions = mentionLabels
    .map((label) => label.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const mentionPart = mentions.length ? `@(?:${mentions.join("|")})` : "@[^\\s]+";
  return new RegExp(`(^|\\s)(${mentionPart}|https?:\\/\\/[^\\s]+)`, "g");
}

function composerPlainText(element: HTMLDivElement) {
  let text = element.innerText || "";
  const last = element.lastChild;
  if (last && last.nodeName === "BR") text = text.replace(/\n$/, "");
  return text;
}

function formatText(element: HTMLDivElement, mentionLabels: string[]) {
  const text = element.innerText || "";
  const pattern = linkPattern(mentionLabels);
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchStart = match.index ?? 0;
    const token = match[2];
    const tokenStart = matchStart + match[1].length;
    if (tokenStart > lastIndex) fragment.append(document.createTextNode(text.slice(lastIndex, tokenStart)));

    const link = document.createElement("a");
    link.href = token.startsWith("@") ? "#" : token;
    link.textContent = token;
    link.dataset.composerLink = "true";
    link.className = "underline underline-offset-2 hover:text-primary";
    link.addEventListener("click", (event) => event.preventDefault());
    fragment.append(link);
    lastIndex = tokenStart + token.length;
  }

  if (lastIndex < text.length) fragment.append(document.createTextNode(text.slice(lastIndex)));
  element.replaceChildren(fragment);
}

function caretOffset(element: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return element.textContent?.length || 0;
  const range = selection.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

type ComposerSelection = {
  start: number;
  end: number;
  text: string;
};

function selectionOffsets(element: HTMLDivElement): Omit<ComposerSelection, "text"> | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;

  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  return { start: startRange.toString().length, end: endRange.toString().length };
}

function pointAtOffset(element: HTMLDivElement, offset: number) {
  let remaining = Math.max(0, offset);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return { node: element as Node, offset: element.childNodes.length };
}

function restoreSelection(element: HTMLDivElement, offsets: Omit<ComposerSelection, "text">) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const start = pointAtOffset(element, offsets.start);
  const end = pointAtOffset(element, Math.max(offsets.start, offsets.end));
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const RichComposerInput = forwardRef<HTMLDivElement, RichComposerInputProps>(
  function RichComposerInput(
    {
      value,
      mentionLabels = [],
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
    const editorRef = useRef<HTMLDivElement>(null);
    const selectionRef = useRef<ComposerSelection | null>(null);
    useImperativeHandle(ref, () => editorRef.current as HTMLDivElement);

    const captureSelection = () => {
      const element = editorRef.current;
      if (!element) return;
      const offsets = selectionOffsets(element);
      if (!offsets) return;
      selectionRef.current = { ...offsets, text: composerPlainText(element) };
    };

    useEffect(() => {
      const handleSelectionChange = () => {
        if (document.activeElement === editorRef.current) captureSelection();
      };
      document.addEventListener("selectionchange", handleSelectionChange);
      return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, []);

    useLayoutEffect(() => {
      const element = editorRef.current;
      if (!element) return;
      const current = composerPlainText(element);
      if (!shouldSyncComposerDom(current, value, document.activeElement === element)) return;
      if (selectionRef.current?.text !== value) selectionRef.current = null;
      element.textContent = value;
      if (value) formatText(element, mentionLabels);
    }, [mentionLabels, value]);

    return (
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        className={cn(
          "rich-composer-input min-h-9 max-h-[180px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-none px-3 pt-1.5 pb-0.5 text-[15px] leading-6 outline-none",
          "focus-visible:ring-0",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
        onInput={(event) => {
          const element = event.currentTarget;
          const cursor = caretOffset(element);
          const text = composerPlainText(element);
          const offsets = selectionOffsets(element) || { start: cursor, end: cursor };
          selectionRef.current = { ...offsets, text };
          onChange(text, cursor);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={(event) => {
          onFocus?.(event);
          const saved = selectionRef.current;
          const element = event.currentTarget;
          if (!saved || saved.text !== composerPlainText(element)) return;
          window.requestAnimationFrame(() => {
            if (document.activeElement === element && saved.text === composerPlainText(element)) {
              restoreSelection(element, saved);
            }
          });
        }}
        onBlur={(event) => {
          const element = event.currentTarget;
          captureSelection();
          formatText(element, mentionLabels);
          onBlur?.(event);
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("[data-composer-link]")) event.preventDefault();
        }}
      />
    );
  },
);
