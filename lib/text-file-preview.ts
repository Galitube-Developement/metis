/** Read a bounded preview instead of buffering a potentially 1 GB text file. */
export async function readTextFilePreview(response: Response, limit = 1024 * 1024): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", total = 0, truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const length = Math.min(value.byteLength, limit - total);
      text += decoder.decode(value.subarray(0, length), { stream: true });
      total += length;
      if (total >= limit) { truncated = true; await reader.cancel(); break; }
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return text + (truncated ? "\n\n…Preview truncated. Download the file for its full contents." : "");
}
