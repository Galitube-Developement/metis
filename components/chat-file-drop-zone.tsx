"use client";

import type { ReactNode } from "react";
import { FileDropZone } from "@/components/file-drop-zone";
export { hasDraggedFiles } from "@/lib/file-drop";

export function ChatFileDropZone({ children, className, enabled = true, onFiles }: {
  children: ReactNode; className?: string; enabled?: boolean; onFiles: (files: FileList) => void;
}) {
  return <FileDropZone className={className} enabled={enabled} onFiles={onFiles}
    title="Drop files here to attach to chat" detail="Files are added to your next message.">
    {children}
  </FileDropZone>;
}
