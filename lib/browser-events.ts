/** One subscription/cleanup path for local preference changes and keyboard listeners. */
export function subscribeToWindowEvents(
  names: readonly string[],
  callback: EventListener,
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window,
) {
  for (const name of names) target.addEventListener(name, callback);
  return () => {
    for (const name of names) target.removeEventListener(name, callback);
  };
}
