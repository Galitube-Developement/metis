type BrowserResource = { close(): Promise<unknown> };

/** A dead CDP connection must not block every future idle-cleanup pass. */
export async function closeBrowserResources(resources: Iterable<BrowserResource>, timeoutMs = 5_000): Promise<void> {
  await Promise.all(Array.from(resources, async (resource) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => resource.close()).catch(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }));
}
