"use client";

import { useEffect, useRef, useState, type ReactNode, type TouchEventHandler } from "react";
import { Files, Paperclip } from "lucide-react";
import { registerFileDrop } from "@/lib/file-drop";

export { hasDraggedFiles } from "@/lib/file-drop";

export function ChatFileDropZone({ children, className, enabled = true, onFiles, onTouchStart, onTouchEnd }: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  onFiles: (files: FileList) => void;
  onTouchStart?: TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: TouchEventHandler<HTMLDivElement>;
}) {
  const [active, setActive] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    setActive(false);
    if (!enabled) return;
    return registerFileDrop(document, {
      // Notes own their drops, including pinned notes in the chat.
      accepts: (event) => !(event.target instanceof Element && event.target.closest("[data-note-drop-target]")),
      containsTarget: (target) => target instanceof Node && document.contains(target),
      onActive: setActive,
      onFiles: (files) => onFilesRef.current(files),
      resetTarget: window,
    });
  }, [enabled]);

  return (
    <div className={className} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
      <div className="chat-file-drop-overlay" data-active={enabled && active} aria-hidden={!enabled || !active}>
        <div className="chat-file-drop-frame" />
        <div className="chat-file-drop-message" role="status" aria-live="polite">
          <div className="chat-file-drop-symbol" aria-hidden="true">
            <Files size={54} strokeWidth={1.3} />
            <span><Paperclip size={18} strokeWidth={1.6} /></span>
          </div>
          <p className="chat-file-drop-cue">Release to attach</p>
          <h2>Drop files here<br />to attach to chat</h2>
          <p className="chat-file-drop-detail">Files are added to your next message.</p>
        </div>
      </div>
    </div>
  );
}
