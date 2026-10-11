import { createToolInputProgress } from "@/lib/tool-input-progress";
import { classifyToolKind, todosFromToolPayload } from "@/lib/tool-call-display";
import type { ToolPart } from "@/lib/store";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// SDK assistant/user envelopes carry message.content, not a message array.
export function claudeMessageContent(message: RecordValue): RecordValue[] {
  const content = Array.isArray(message.message) ? message.message : record(message.message).content;
  return Array.isArray(content) ? content.map(record) : [];
}

export function createClaudeToolEvents(onTool: (tool: ToolPart) => void, now = Date.now) {
  const tools = new Map<string, ToolPart>();
  const blocks = new Map<string, { id: string; json: string }>();
  const publish = (tool: ToolPart) => {
    const previous = tools.get(tool.id);
    const merged = { ...previous, ...tool };
    merged.source ||= merged.name.startsWith("mcp__") ? "mcp" : "native";
    merged.kind = classifyToolKind(merged.name, merged.input, merged.result);
    const todos = merged.kind === "todo" ? todosFromToolPayload(merged.input, merged.result) : undefined;
    if (todos?.length) merged.todos = todos;
    if (previous && JSON.stringify(previous) === JSON.stringify(merged)) return;
    tools.set(tool.id, merged);
    onTool({ ...merged });
  };
  const progress = createToolInputProgress(publish, now);
  const start = (block: RecordValue, preparing = false) => {
    const id = string(block.id);
    const name = string(block.name);
    if (!id || !name) return;
    // A completed assistant snapshot may replay the streamed tool start.
    const previous = tools.get(id);
    if (preparing) {
      progress.start(id, name);
      return;
    }
    progress.executing({
      id, name, status: previous?.status || "running",
      source: name.startsWith("mcp__") ? "mcp" : "native",
      ...(block.input !== undefined ? { input: JSON.stringify(block.input) } : {}),
    });
  };

  return (message: RecordValue) => {
    if (message.type === "assistant") {
      for (const block of claudeMessageContent(message)) if (block.type === "tool_use") start(block);
    } else if (message.type === "user") {
      for (const block of claudeMessageContent(message)) {
        if (block.type !== "tool_result") continue;
        const id = string(block.tool_use_id);
        const previous = tools.get(id);
        if (!previous) continue; // Resume history can include results from an earlier run.
        progress.publish({
          ...previous,
          status: block.is_error === true ? "error" : "completed",
          ...(block.content !== undefined ? {
            result: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          } : {}),
        });
      }
    } else if (message.type === "stream_event") {
      const event = record(message.event);
      const scope = string(message.parent_tool_use_id);
      const key = `${scope}:${event.index}`;
      if (event.type === "message_start") {
        for (const blockKey of blocks.keys()) if (blockKey.startsWith(`${scope}:`)) blocks.delete(blockKey);
      } else if (event.type === "content_block_start") {
        const block = record(event.content_block);
        if (block.type === "tool_use") {
          start(block, true);
          if (string(block.id)) blocks.set(key, { id: string(block.id), json: "" });
        }
      } else if (event.type === "content_block_delta") {
        const delta = record(event.delta);
        const block = blocks.get(key);
        if (block && delta.type === "input_json_delta") {
          const fragment = string(delta.partial_json);
          block.json += fragment;
          progress.delta(block.id, fragment);
        }
      } else if (event.type === "content_block_stop") {
        const block = blocks.get(key);
        if (block) progress.end(block.id);
        const previous = block && tools.get(block.id);
        if (block?.json && previous) {
          try {
            progress.executing({ ...previous, input: JSON.stringify(JSON.parse(block.json)) });
          } catch {
            // The full assistant snapshot remains authoritative for malformed/incomplete deltas.
          }
        }
        blocks.delete(key);
      }
    } else if (message.type === "tool_progress") {
      const id = string(message.tool_use_id);
      const previous = tools.get(id);
      if (previous) progress.executing(previous);
      else start({ id, name: message.tool_name });
    } else if (message.type === "result") {
      // Older SDK builds may omit user result envelopes. The turn result ends outstanding calls.
      for (const tool of tools.values()) {
        if (tool.status === "running") progress.publish({
          ...tool, status: message.is_error === true ? "error" : "completed",
        });
      }
      blocks.clear();
    }
  };
}
