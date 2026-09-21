import { readFileSync } from "node:fs";
import { resolveAgentPath } from "@/lib/revert";
import type { ToolPart } from "@/lib/store";

function parseToolInput(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function localFileOperation(name: string) {
  const normalized = name.trim().toLowerCase();
  if (/(^|[_:/.-])write_file$/.test(normalized)) return "write" as const;
  if (/(^|[_:/.-])edit_file$/.test(normalized)) return "edit" as const;
  if (/(^|[_:/.-])delete_file$/.test(normalized)) return "delete" as const;
  return undefined;
}

function readSnapshot(rawPath: string, agentCwd: string) {
  const filePath = resolveAgentPath(rawPath, agentCwd);
  if (!filePath) return undefined;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

/** Capture local provider file tools around their lifecycle for message Revert. */
export function withLocalFileEditSnapshot(
  tool: ToolPart,
  previous: ToolPart | undefined,
  agentCwd: string,
): ToolPart {
  const operation = localFileOperation(tool.name || previous?.name || "");
  if (!operation) return tool;

  const input = parseToolInput(tool.input) ?? parseToolInput(previous?.input);
  const target = typeof input?.target === "string" ? input.target : "server";
  if (target !== "server" && target !== "local") return tool;

  const rawPath = [tool.path, previous?.path, input?.path, input?.filePath, input?.filename]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!rawPath) return tool;

  if (tool.status === "running") {
    return {
      ...tool,
      path: rawPath,
      diff: { before: previous?.diff?.before ?? readSnapshot(rawPath, agentCwd) },
    };
  }

  if (tool.status !== "completed" || !previous?.diff) return tool;
  const after = operation === "delete" ? undefined : readSnapshot(rawPath, agentCwd);
  return {
    ...tool,
    path: rawPath,
    diff: { ...previous.diff, after },
  };
}
