import type { ToolPart } from "@/lib/store";

export type ToolInputPart = ToolPart & { phase?: "preparing" | "executing"; inputChars?: number };

/** Tracks only counts, never incomplete argument text. Each SDK identity owns its throttle. */
export function createToolInputProgress(onTool: (tool: ToolInputPart) => void, now = Date.now) {
  const tools = new Map<string, ToolInputPart>();
  const inputs = new Map<string, { chars: number; publishedAt: number; ended: boolean }>();
  const publish = (tool: ToolInputPart) => {
    const previous = tools.get(tool.id);
    if (previous && previous.status !== "running") return;
    const input = inputs.get(tool.id);
    const merged = { ...previous, ...tool, ...(input ? { inputChars: input.chars } : {}) };
    if (previous && JSON.stringify(previous) === JSON.stringify(merged)) return;
    tools.set(tool.id, merged);
    onTool({ ...merged });
  };
  const end = (id: string) => {
    const input = inputs.get(id);
    const tool = tools.get(id);
    if (!input || !tool || tool.status !== "running") return;
    input.ended = true;
    publish(tool); // Flush the last throttled count without parsing or executing it.
  };
  return {
    publish,
    start(id: string, name: string) {
      if (!id || !name || tools.has(id)) return;
      inputs.set(id, { chars: 0, publishedAt: now(), ended: false });
      publish({ id, name, status: "running", phase: "preparing" });
    },
    delta(id: string, delta: string) {
      const input = inputs.get(id);
      const tool = tools.get(id);
      if (!input || input.ended || tool?.status !== "running" || tool.phase !== "preparing") return;
      input.chars += delta.length;
      if (now() - input.publishedAt >= 100) {
        input.publishedAt = now();
        publish(tool);
      }
    },
    end,
    flush() {
      for (const id of inputs.keys()) end(id);
    },
    executing(tool: ToolPart) {
      const input = inputs.get(tool.id);
      if (input) input.ended = true;
      publish({ ...tool, phase: "executing" });
    },
  };
}
