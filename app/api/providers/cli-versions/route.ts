import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { listCliVersions } from "@/lib/cli-versions";
import { managedCliManifest, managedCliPackages, managedCliRoot, type ManagedCliId } from "@/lib/providers/managed-cli";
import { providerProcessEnv } from "@/lib/providers/process-env";
import { isHostAdmin } from "@/lib/user-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
let installing = false;

async function latestPackageVersion(packageName: string) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const body = await response.json() as { version?: unknown };
    return typeof body.version === "string" && versionPattern.test(body.version) ? body.version : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [versions, latestEntries] = await Promise.all([
    listCliVersions(),
    Promise.all(Object.entries(managedCliPackages).map(async ([id, value]) => [id, await latestPackageVersion(value.packageName)] as const)),
  ]);
  return Response.json({ versions, latestVersions: Object.fromEntries(latestEntries) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function installManagedCli(id: ManagedCliId, version: string, tracking: "latest" | "pinned") {
  const destination = path.join(managedCliRoot(id), version);
  await mkdir(destination, { recursive: true });
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmArgs = process.platform === "win32"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
    : [];
  await execFileAsync(npmCommand, [
    ...npmArgs, "install", "--prefix", destination, "--no-save", "--no-audit", "--no-fund",
    `${managedCliPackages[id].packageName}@${version}`,
  ], { timeout: 240_000, maxBuffer: 64_000, env: { ...providerProcessEnv(), HOME: os.homedir() } });
  const executable = path.join(destination, "node_modules", ".bin", process.platform === "win32" ? `${managedCliPackages[id].binary}.cmd` : managedCliPackages[id].binary);
  const { stdout, stderr } = process.platform === "win32"
    ? await execFileAsync("cmd.exe", ["/d", "/s", "/c", `"${executable}" --version`], { timeout: 10_000, maxBuffer: 16_384, env: { ...providerProcessEnv(), HOME: os.homedir() } })
    : await execFileAsync(executable, ["--version"], { timeout: 10_000, maxBuffer: 16_384, env: { ...providerProcessEnv(), HOME: os.homedir() } });
  if (!(stdout + stderr).includes(version)) throw new Error("The installed CLI failed its version check.");
  const manifest = managedCliManifest(id);
  const temporary = `${manifest}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version, executable, tracking }), { mode: 0o600 });
  await rename(temporary, manifest);
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) {
    return Response.json({ error: "Only host administrators can install CLI versions." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as { provider?: unknown; version?: unknown };
  const provider = body.provider;
  const managed = provider === "codex" || provider === "grok" || provider === "opencode";
  if (!managed && provider !== "cursor" && provider !== "antigravity") {
    return Response.json({ error: "Choose an installable CLI." }, { status: 400 });
  }
  if (body.version !== undefined && (typeof body.version !== "string" || !versionPattern.test(body.version))) {
    return Response.json({ error: "Choose a valid CLI version." }, { status: 400 });
  }
  if (!managed && body.version !== undefined) {
    return Response.json({ error: "This CLI supports updating to the latest version only." }, { status: 400 });
  }
  if (installing) return Response.json({ error: "A CLI installation is already running." }, { status: 409 });
  installing = true;
  try {
    if (managed) {
      const id = provider as ManagedCliId;
      const version = body.version || await latestPackageVersion(managedCliPackages[id].packageName);
      if (!version || !versionPattern.test(version)) throw new Error("Could not determine a valid package version.");
      await installManagedCli(id, version, body.version ? "pinned" : "latest");
    } else {
      const command = provider === "cursor" ? "cursor-agent" : "agy";
      await execFileAsync(command, ["update"], { timeout: 240_000, maxBuffer: 64_000, env: { ...providerProcessEnv(), HOME: os.homedir() } });
    }
    return Response.json({ ok: true, versions: await listCliVersions() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CLI installation failed." }, { status: 500 });
  } finally {
    installing = false;
  }
}
