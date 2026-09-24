import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { activeManagedCli, managedCliExecutable, managedCliManifest, managedCliRoot } from "@/lib/providers/managed-cli";

export const codexCliRoot = managedCliRoot("codex");
export const codexCliManifest = managedCliManifest("codex");

export function activeCodexCli() {
  return activeManagedCli("codex");
}

export function codexCliExecutable() {
  return managedCliExecutable("codex", path.join(config.root, "node_modules", ".bin", "codex"));
}

export function codexCliVersion() {
  const active = activeCodexCli();
  if (active) return active.version;
  try {
    const manifest = JSON.parse(readFileSync(path.join(config.root, "node_modules", "@openai", "codex", "package.json"), "utf8")) as { version?: string };
    return manifest.version || "";
  } catch {
    return "";
  }
}
