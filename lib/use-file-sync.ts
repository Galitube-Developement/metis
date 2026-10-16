"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeFileContents, type FileSnapshot } from "@/lib/file-sync";
import { FileSyncError, requestFileSnapshot } from "@/lib/file-sync-client";

export function useFileSync(path: string, paused: boolean, applyDiskContent?: (text: string) => void) {
  const [content, setDraft] = useState(""), [savedContent, setBase] = useState(""), [revision, setRevision] = useState("");
  const [conflict, setConflict] = useState<FileSnapshot | null>(null), [reviewing, setReviewing] = useState(false);
  const [syncError, setSyncError] = useState(""), [syncMessage, setSyncMessage] = useState("");
  const state = useRef({ path, content, savedContent, revision, conflict, paused });
  const applyDisk = useRef(applyDiskContent); applyDisk.current = applyDiskContent;
  const generation = useRef(0), saving = useRef(false), syncing = useRef(false), alive = useRef(true);
  state.current = { path, content, savedContent, revision, conflict, paused };
  const setContent = useCallback((value: string) => { state.current.content = value; setDraft(value); }, []);
  const loadSnapshot = useCallback((nextPath: string, snapshot: FileSnapshot) => {
    generation.current++;
    state.current = { ...state.current, path: nextPath, content: snapshot.content, savedContent: snapshot.content, revision: snapshot.revision, conflict: null };
    setDraft(snapshot.content); setBase(snapshot.content); setRevision(snapshot.revision);
    setConflict(null); setReviewing(false); setSyncError(""); setSyncMessage("");
  }, []);
  const reconcile = useCallback((snapshot: FileSnapshot) => {
    const current = state.current;
    if (current.conflict && snapshot.content !== current.savedContent) { state.current.conflict = snapshot; setConflict(snapshot); return false; }
    if (current.conflict) { state.current.conflict = null; setConflict(null); setReviewing(false); }
    const merge = mergeFileContents(current.savedContent, current.content, snapshot.content);
    if (merge.conflict) { state.current.conflict = snapshot; setConflict(snapshot); setReviewing(false); setSyncMessage(""); return false; }
    const wasDirty = current.content !== current.savedContent;
    applyDisk.current?.(merge.content);
    state.current = { ...current, content: merge.content, savedContent: snapshot.content, revision: snapshot.revision };
    setDraft(merge.content); setBase(snapshot.content); setRevision(snapshot.revision);
    setSyncError(""); setSyncMessage(wasDirty && merge.content !== snapshot.content ? "Disk changes merged · unsaved" : "Updated from disk");
    return true;
  }, []);
  const syncNow = useCallback(async () => {
    const current = state.current, version = generation.current;
    if (!current.path || !current.revision || current.paused || saving.current || syncing.current) return;
    syncing.current = true;
    try {
      const snapshot = await requestFileSnapshot({ action: "snapshot", path: current.path, revision: current.conflict?.revision || current.revision });
      if (!alive.current || generation.current !== version || state.current.path !== current.path || state.current.paused || saving.current || state.current.revision !== current.revision || state.current.conflict?.revision !== current.conflict?.revision) return;
      setSyncError("");
      if (!snapshot.unchanged) reconcile(snapshot);
    } catch (error) {
      if (alive.current && generation.current === version && state.current.path === current.path) setSyncError(error instanceof Error ? error.message : "Could not sync this file.");
    } finally { syncing.current = false; }
  }, [reconcile]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    const focus = () => { if (document.visibilityState !== "hidden") void syncNow(); };
    const timer = window.setInterval(focus, 2000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [path, syncNow]);
  const saveCurrent = useCallback(async (resolved?: FileSnapshot) => {
    if (saving.current) return false;
    const current = state.current, version = generation.current, draft = current.content;
    if (!current.path || (!resolved && current.conflict)) return false;
    const expected = resolved?.revision || current.revision;
    if (!expected) { setSyncError("Reload the file before saving."); return false; }
    saving.current = true; setSyncError("");
    try {
      const snapshot = await requestFileSnapshot({ action: "save", path: current.path, revision: expected, content: draft });
      if (!alive.current || version !== generation.current || current.path !== state.current.path) return false;
      // Typing during the save stays in the draft; only the sent snapshot becomes the base.
      state.current = { ...state.current, savedContent: draft, revision: snapshot.revision, conflict: null };
      setBase(draft); setRevision(snapshot.revision); setConflict(null); setReviewing(false); setSyncMessage("Synced with disk"); return true;
    } catch (error) {
      if (!alive.current || version !== generation.current || current.path !== state.current.path) return false;
      if (error instanceof FileSyncError && error.snapshot) {
        if (resolved) { state.current.conflict = error.snapshot; setConflict(error.snapshot); }
        else reconcile(error.snapshot);
        setSyncMessage("The disk changed before saving. Review the updated draft and save again.");
      } else setSyncError(error instanceof Error ? error.message : "Could not save this file.");
      return false;
    } finally { saving.current = false; }
  }, [reconcile]);
  const useDisk = useCallback(() => {
    const snapshot = state.current.conflict;
    if (snapshot) loadSnapshot(state.current.path, snapshot);
  }, [loadSnapshot]);
  return { content, savedContent, revision, conflict, reviewing, setReviewing, syncError, syncMessage, setContent, loadSnapshot, syncNow, saveCurrent, useDisk };
}
