export type FileTransfer = Pick<DataTransfer, "types"> & Partial<Pick<DataTransfer, "items" | "files">>;

export function hasDraggedFiles(transfer: FileTransfer | null) {
  if (!transfer) return false;
  return Array.from(transfer.types || []).some((type) => type.toLowerCase() === "files" || type === "application/x-moz-file")
    || Array.from(transfer.items || []).some((item) => item.kind === "file")
    || Boolean(transfer.files?.length);
}

type FileDropOptions = {
  accepts?: (event: DragEvent) => boolean;
  containsTarget: (target: EventTarget | null) => boolean;
  onActive: (active: boolean) => void;
  onFiles: (files: FileList) => void;
  resetTarget?: EventTarget;
};

/** Native capture runs before editors and React handlers can reject an OS file drag. */
export function registerFileDrop(host: EventTarget, options: FileDropOptions) {
  const reset = () => options.onActive(false);
  const accepts = (event: DragEvent) => hasDraggedFiles(event.dataTransfer) && (options.accepts?.(event) ?? true);
  const accept = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const over = (raw: Event) => {
    const event = raw as DragEvent;
    if (!accepts(event)) { reset(); return; }
    accept(event);
    options.onActive(true);
  };
  const leave = (raw: Event) => {
    const event = raw as DragEvent;
    if (!options.containsTarget(event.relatedTarget)) reset();
  };
  const drop = (raw: Event) => {
    const event = raw as DragEvent;
    reset();
    if (!accepts(event)) return;
    accept(event);
    if (event.dataTransfer?.files.length) options.onFiles(event.dataTransfer.files);
  };
  const key = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape") reset();
  };
  const resetTarget = options.resetTarget || host;
  const capture = { capture: true };
  host.addEventListener("dragenter", over, capture);
  host.addEventListener("dragover", over, capture);
  host.addEventListener("dragleave", leave, capture);
  host.addEventListener("drop", drop, capture);
  resetTarget.addEventListener("dragend", reset);
  resetTarget.addEventListener("drop", reset);
  resetTarget.addEventListener("blur", reset);
  resetTarget.addEventListener("keydown", key);
  return () => {
    host.removeEventListener("dragenter", over, capture);
    host.removeEventListener("dragover", over, capture);
    host.removeEventListener("dragleave", leave, capture);
    host.removeEventListener("drop", drop, capture);
    resetTarget.removeEventListener("dragend", reset);
    resetTarget.removeEventListener("drop", reset);
    resetTarget.removeEventListener("blur", reset);
    resetTarget.removeEventListener("keydown", key);
  };
}
