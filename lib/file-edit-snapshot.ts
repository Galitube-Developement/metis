import { readFileSync } from "node:fs";
import path from "node:path";
import { editedFileFromTool } from "@/lib/edited-files";
import { resolveAgentPath } from "@/lib/revert";
import { innerToolName, unwrapToolRecord } from "@/lib/tool-call-display";
import { readFileEditSnapshot, type FileSnapshotScope } from "@/lib/mcp-core/file-edit-snapshots.mjs";
import type { ToolPart } from "@/lib/store";

/** Resolve relative edits against the actual per-run workspace before persistence/SSE. */
export function withEditedFileTracking(tool: ToolPart, agentCwd: string, previous?: ToolPart, scope?: FileSnapshotScope): ToolPart {
  if (tool.status !== "completed") return tool;
  const result = unwrapToolRecord(tool.result);
  const saved = readFileEditSnapshot(result?.fileSnapshotRef, scope);
  if (saved) {
    tool = { ...tool, kind: "edit", path: saved.path, diff: saved.diff,
      editedFile: { path: saved.path, target: saved.target } };
  } else if (result?.fileSnapshotRef && previous?.diff) {
    // The staging receipt may already have been acknowledged by a checkpoint.
    tool = { ...tool, diff: previous.diff };
  }
  const editedFile = editedFileFromTool({ ...previous, ...tool, input: tool.input ?? previous?.input, path: tool.path ?? previous?.path });
  return { ...tool, editedFile: editedFile ? {
    ...editedFile,
    path: editedFile.target === "server" ? path.resolve(agentCwd, editedFile.path) : editedFile.path,
  } : null };
}

function parseToolInput(value: string | undefined) {
  return unwrapToolRecord(value);
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
    return { before: readFileSync(filePath, "utf8") };
  } catch (error) {
    // A missing file is a known creation; unreadable/out-of-scope is unknown.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { before: undefined } : undefined;
  }
}

/** Capture local provider file tools around their lifecycle for message Revert. */
export function withLocalFileEditSnapshot(
  tool: ToolPart,
  previous: ToolPart | undefined,
  agentCwd: string,
): ToolPart {
  const input = parseToolInput(tool.input) ?? parseToolInput(previous?.input);
  const name = innerToolName(tool.name || previous?.name || "", input);
  const operation = localFileOperation(name);
  if (!operation) return tool;

  const target = typeof input?.target === "string" ? input.target
    : input?.client_id || input?.clientId ? "client" : "server";
  if (target !== "server" && target !== "local") return tool;

  const rawPath = [tool.path, previous?.path, input?.path, input?.filePath, input?.file_path, input?.filename]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!rawPath) return tool;

  const captured = tool.diff && Object.prototype.hasOwnProperty.call(tool.diff, "before") ? tool.diff
    : previous?.diff && Object.prototype.hasOwnProperty.call(previous.diff, "before") ? previous.diff : undefined;
  if (tool.status === "running") {
    if (tool.phase === "preparing") return tool;
    const before = captured ?? readSnapshot(rawPath, agentCwd);
    return before ? { ...tool, path: rawPath, diff: before } : tool;
  }

  if (tool.status !== "completed" || !captured) return tool;
  if (typeof tool.diff?.after === "string" || typeof previous?.diff?.after === "string") {
    return { ...tool, path: rawPath, diff: { ...previous?.diff, ...tool.diff } };
  }
  const after = operation === "delete" ? undefined : readSnapshot(rawPath, agentCwd)?.before;
  return { ...tool, path: rawPath, diff: { ...captured, after } };
}
