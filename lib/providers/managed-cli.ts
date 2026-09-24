import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

export type ManagedCliId = "codex" | "grok" | "opencode";

export const managedCliPackages: Record<ManagedCliId, { packageName: string; binary: string }> = {
  codex: { packageName: "@openai/codex", binary: "codex" },
  grok: { packageName: "@xai-official/grok", binary: "grok" },
  opencode: { packageName: "opencode-ai", binary: "opencode" },
};

export function managedCliRoot(id: ManagedCliId) {
  return path.join(config.dataDir, "agent-runtimes", id);
}

export function managedCliManifest(id: ManagedCliId) {
  return path.join(managedCliRoot(id), "active.json");
}

export function activeManagedCli(id: ManagedCliId): { version: string; executable: string } | null {
  try {
    const data = JSON.parse(readFileSync(managedCliManifest(id), "utf8")) as { version?: unknown; executable?: unknown };
    if (typeof data.version !== "string" || typeof data.executable !== "string") return null;
    const root = path.resolve(managedCliRoot(id));
    const executable = path.resolve(data.executable);
    if (!executable.startsWith(root + path.sep) || !existsSync(executable)) return null;
    const packageFile = path.join(root, data.version, "node_modules", ...managedCliPackages[id].packageName.split("/"), "package.json");
    const manifest = JSON.parse(readFileSync(packageFile, "utf8")) as { version?: string };
    if (manifest.version !== data.version) return null;
    return { version: data.version, executable };
  } catch {
    return null;
  }
}

export function managedCliExecutable(id: ManagedCliId, fallback: string) {
  return activeManagedCli(id)?.executable || fallback;
}
