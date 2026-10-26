"use client";

import { useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function SettingsDialog({ open, onOpenChange, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[min(88dvh,56rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-4rem))]"
      onOpenAutoFocus={() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { if (previousFocus.current?.isConnected) { event.preventDefault(); previousFocus.current.focus(); } }}>
      <DialogTitle className="sr-only">Settings</DialogTitle>
      <DialogDescription className="sr-only">Manage your preferences, providers, and devices.</DialogDescription>
      {children}
    </DialogContent>
  </Dialog>;
}
