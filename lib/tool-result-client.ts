export type FullToolPayload = { input?: string; result?: string };

/** Fetch only after the user opens a tool. The server enforces chat ownership. */
export async function loadToolPayload(url: string, signal?: AbortSignal): Promise<FullToolPayload> {
  if (!/^\/api\/chats\/[^/]+\/tool-result\?/.test(url)) throw new Error("Invalid tool output URL");
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not load full tool details");
  const payload = await response.json() as FullToolPayload;
  if (typeof payload.result !== "string" && typeof payload.input !== "string") throw new Error("Tool details are unavailable");
  return {
    ...(typeof payload.input === "string" ? { input: payload.input } : {}),
    ...(typeof payload.result === "string" ? { result: payload.result } : {}),
  };
}

export async function loadToolResult(url: string, signal?: AbortSignal): Promise<string> {
  const payload = await loadToolPayload(url, signal);
  if (typeof payload.result !== "string") throw new Error("Tool output is unavailable");
  return payload.result;
}
