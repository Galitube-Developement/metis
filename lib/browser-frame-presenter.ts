import { replaceBrowserFrameUrl } from "./browser-frame-url";

type Frame = Blob | string;
type FrameImage = Pick<HTMLImageElement, "src" | "onload" | "onerror" | "addEventListener" | "removeEventListener" | "removeAttribute">;

/** One image decode in flight and one latest frame waiting; never queue a session's frames. */
export function createBrowserFramePresenter(image: FrameImage, onFrame: () => void, schedule = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let pending: Frame | null = null;
  let frameId: number | null = null;
  let loading = false;
  let disposed = false;
  let objectUrl: string | null = null;

  const scheduleNext = () => {
    if (!disposed && !loading && pending !== null && frameId === null) {
      frameId = schedule(present);
    }
  };
  const settled = (event: Event) => {
    if (disposed || !loading) return;
    loading = false;
    if (event.type === "load") onFrame();
    scheduleNext();
  };
  function present() {
    frameId = null;
    if (disposed || loading || pending === null) return;
    const next = pending;
    pending = null;
    loading = true;
    if (typeof next === "string") {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      image.src = next;
    } else {
      objectUrl = replaceBrowserFrameUrl(objectUrl, next, image);
    }
  }
  image.addEventListener("load", settled);
  image.addEventListener("error", settled);
  return {
    push(frame: Frame) {
      if (disposed) return;
      pending = frame;
      scheduleNext();
    },
    dispose() {
      disposed = true;
      pending = null;
      if (frameId !== null) cancel(frameId);
      frameId = null;
      image.removeEventListener("load", settled);
      image.removeEventListener("error", settled);
      image.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    },
  };
}

export type BrowserFramePresenter = ReturnType<typeof createBrowserFramePresenter>;
