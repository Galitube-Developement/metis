/** Fetch only after the user opens an output. The server enforces chat ownership. */
export async function loadToolResult(url: string, signal?: AbortSignal): Promise<string> {
  if (!/^\/api\/chats\/[^/]+\/tool-result\?/.test(url)) throw new Error("Invalid tool output URL");
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not load full output");
  const payload = await response.json() as { result?: unknown };
  if (typeof payload.result !== "string") throw new Error("Tool output is unavailable");
  return payload.result;
}
