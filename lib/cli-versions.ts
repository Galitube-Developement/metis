import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "@/lib/config";
import { codexCliVersion, activeCodexCli } from "@/lib/providers/codex-cli";
import { activeManagedCli, managedCliExecutable } from "@/lib/providers/managed-cli";

const execFileAsync = promisify(execFile);

export type CliVersion = {
  id: string;
  name: string;
  version: string | null;
  source: string;
  note?: string;
  installable?: boolean;
  supportsVersion?: boolean;
};

async function packageVersion(name: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(config.root, "node_modules", name, "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

async function commandVersion(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 5_000,
      maxBuffer: 16_384,
      env: process.env,
    });
    return (stdout || stderr).trim().split(/\r?\n/)[0]?.slice(0, 160) || null;
  } catch {
    return null;
  }
}

export async function listCliVersions(): Promise<CliVersion[]> {
  const [codexSdk, claudeSdk, cursorSdk, cursor, antigravity, grok, opencode] = await Promise.all([
    packageVersion("@openai/codex-sdk"),
    packageVersion("@anthropic-ai/claude-agent-sdk"),
    packageVersion("@cursor/sdk"),
    commandVersion("cursor-agent", ["--version"]),
    commandVersion("agy", ["--version"]),
    commandVersion(managedCliExecutable("grok", "grok"), ["--version"]),
    commandVersion(managedCliExecutable("opencode", "opencode"), ["--version"]),
  ]);
  return [
    { id: "codex", name: "Codex CLI", version: codexCliVersion() || null, source: activeCodexCli() ? "Managed CLI install" : "Metis package", installable: true, supportsVersion: true },
    { id: "codex-sdk", name: "Codex SDK", version: codexSdk, source: "Metis package", note: "Updated with Metis." },
    { id: "claude", name: "Claude Agent SDK / CLI", version: claudeSdk, source: "Metis package", note: "Updated with Metis." },
    { id: "cursor-sdk", name: "Cursor SDK", version: cursorSdk, source: "Metis package", note: "Updated with Metis." },
    { id: "cursor", name: "Cursor Agent CLI", version: cursor, source: "Server PATH", installable: true },
    { id: "antigravity", name: "Antigravity CLI", version: antigravity, source: "Server PATH", installable: true },
    { id: "grok", name: "Grok CLI", version: grok, source: activeManagedCli("grok") ? "Managed CLI install" : "Server PATH", installable: true, supportsVersion: true },
    { id: "opencode", name: "OpenCode CLI", version: opencode, source: activeManagedCli("opencode") ? "Managed CLI install" : "Server PATH", installable: true, supportsVersion: true },
  ];
}
