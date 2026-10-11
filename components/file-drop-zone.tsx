"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Files, Upload } from "lucide-react";
import { hasDraggedFiles, ownsFileDrop, registerFileDrop } from "@/lib/file-drop";

export function FileDropZone({ children, className, enabled = true, title, detail, onFiles }: {
  children: ReactNode; className?: string; enabled?: boolean; title: string; detail: string;
  onFiles: (files: FileList, event: DragEvent) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onFiles);
  callbackRef.current = onFiles;
  const [active, setActive] = useState(false);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    setActive(false);
    // Observe the document so moving directly to another surface clears this overlay.
    // Unowned drops must not navigate the application to a local file.
    const preventNavigation = (event: DragEvent) => { if (hasDraggedFiles(event.dataTransfer)) event.preventDefault(); };
    document.addEventListener("dragover", preventNavigation);
    document.addEventListener("drop", preventNavigation);
    const cleanup = registerFileDrop(document, {
      accepts: event => enabled && ownsFileDrop(surface, event.target),
      containsTarget: target => ownsFileDrop(surface, target),
      onActive: setActive,
      onFiles: (files, event) => callbackRef.current(files, event),
      resetTarget: window,
    });
    return () => {
      cleanup();
      document.removeEventListener("dragover", preventNavigation);
      document.removeEventListener("drop", preventNavigation);
    };
  }, [enabled]);

  return <div ref={surfaceRef} data-file-drop-target className={className}>
    {children}
    <div className="chat-file-drop-overlay" data-active={enabled && active} aria-hidden={!enabled || !active}>
      <div className="chat-file-drop-frame" />
      <div className="chat-file-drop-message" role="status" aria-live="polite">
        <div className="chat-file-drop-symbol" aria-hidden="true">
          <Files size={54} strokeWidth={1.3} /><span><Upload size={18} strokeWidth={1.6} /></span>
        </div>
        <p className="chat-file-drop-cue">Release to upload</p>
        <h2>{title}</h2>
        <p className="chat-file-drop-detail">{detail}</p>
      </div>
    </div>
  </div>;
}
