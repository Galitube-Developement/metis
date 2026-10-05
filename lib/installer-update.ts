import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, open, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const INSTALLER_UPDATE_LOG = "metis-installer-update.log";
export const INSTALLER_UPDATE_SCRIPT = "metis-ai-update-run";
export const INSTALLER_UPDATE_UNIT_SUFFIX = "-self-update";

export type InstallerUpdateInput = {
  root: string;
  docker: boolean;
  channel: "releases" | "commits";
  tag?: string;
  commit?: string;
  serviceName: string;
  dataDir: string;
  platform?: NodeJS.Platform;
};

export type InstallerUpdatePlan = {
  kind: "native" | "docker";
  platform: "linux" | "darwin" | "win32";
  command: string;
  args: string[];
  scriptSource: string;
  logFile: string;
  unitName?: string;
};

export type InstallerUpdateResult = {
  tag: string;
  commit?: string;
  method: "installer";
  asset: string;
};

export function installerSystemdEnvironment(env: NodeJS.ProcessEnv = process.env, root?: string): string[] {
  const home = env.HOME?.trim() || os.homedir();
  const inheritedPath = env.PATH?.trim() || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  // The transient update unit does not run through run-service.sh. Carry the
  // installed Node and pnpm directories into its non-login environment.
  const preferred = [
    env.METIS_PNPM_HOME || "",
    root ? path.join(root, ".runtime", "pnpm", "bin") : "",
    path.dirname(process.execPath),
    env.METIS_NODE_HOME ? path.join(env.METIS_NODE_HOME, "bin") : "",
    root ? path.join(root, ".runtime", "node", "bin") : "",
  ].filter(Boolean);
  const pathEnv = [...new Set([...preferred, ...inheritedPath.split(path.delimiter).filter(Boolean)])].join(path.delimiter);
  let user = env.USER?.trim() || env.LOGNAME?.trim() || "";
  if (!user) {
    try { user = os.userInfo().username; } catch { user = ""; }
  }
  const args = [`--setenv=HOME=${home}`, `--setenv=PATH=${pathEnv}`];
  if (user) args.push(`--setenv=USER=${user}`);
  return args;
}

export function installerLogIndicatesFailure(text: string): boolean {
  return /unbound variable|^Error:|\bError: |Failed to compile\.|Build failed|ELIFECYCLE.*(?:failed|exit code)|ERR_PNPM_/m.test(text);
}

export function installerLogIndicatesSuccess(text: string): boolean {
  return /Metis AI installed successfully/i.test(text);
}

function platformOf(value: NodeJS.Platform | undefined): "linux" | "darwin" | "win32" {
  value ??= process.platform;
  if (value === "darwin") return "darwin";
  if (value === "win32") return "win32";
  if (value === "linux") return "linux";
  throw new Error(`Automatic updates are not supported on platform ${value}.`);
}

export function installerUpdateUnitName(serviceName: string) {
  return `${serviceName}${INSTALLER_UPDATE_UNIT_SUFFIX}`;
}

export function installerUpdateLogPath(dataDir: string) {
  return path.join(dataDir, INSTALLER_UPDATE_LOG);
}

export function installerUpdateScriptPath(dataDir: string, source: string) {
  const ext = path.extname(source) || ".sh";
  return path.join(dataDir, `${INSTALLER_UPDATE_SCRIPT}${ext}`);
}

export function installerUpdateJobMarker(jobId: string) {
  return `[metis-update-job:${jobId}]`;
}

export function installerLogForJob(logText: string, jobId: string) {
  const marker = installerUpdateJobMarker(jobId);
  const markerIndex = logText.lastIndexOf(marker);
  return markerIndex >= 0 ? logText.slice(markerIndex) : "";
}

export async function initializeInstallerUpdateLog(
  dataDir: string,
  jobId: string,
  range?: { fromLabel?: string; toLabel?: string },
) {
  await mkdir(dataDir, { recursive: true });
  const lines = [installerUpdateJobMarker(jobId)];
  if (range?.fromLabel) lines.push(`from: ${range.fromLabel}`);
  if (range?.toLabel) lines.push(`to: ${range.toLabel}`);
  await writeFile(installerUpdateLogPath(dataDir), `${lines.join("\n")}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: 0o600,
  });
}

export function buildInstallerUpdatePlan(input: InstallerUpdateInput): InstallerUpdatePlan {
  const platform = platformOf(input.platform);
  const logFile = installerUpdateLogPath(input.dataDir);
  const tag = input.tag?.trim();
  const unitName = platform === "linux" ? installerUpdateUnitName(input.serviceName) : undefined;

  if (input.docker) {
    const scriptSource = path.join(input.root, "public", "install", "docker.sh");
    const version = input.channel === "releases" && tag ? tag : "latest";
    return {
      kind: "docker",
      platform,
      command: "/bin/bash",
      args: [scriptSource, "--non-interactive", "--install-dir", input.root, "--version", version],
      scriptSource,
      logFile,
      unitName,
    };
  }

  if (platform === "win32") {
    const scriptSource = path.join(input.root, "install", "windows.ps1");
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptSource,
      "-NonInteractive",
      "-Native",
      "-InstallDir",
      input.root,
      "-ServiceName",
      input.serviceName,
    ];
    if (input.channel === "releases" && tag) args.push("-Version", tag);
    if (input.channel === "commits" && input.commit) args.push("-Commit", input.commit);
    return {
      kind: "native",
      platform,
      command: "powershell.exe",
      args,
      scriptSource,
      logFile,
    };
  }

  const scriptSource = path.join(input.root, "install", platform === "darwin" ? "macos.sh" : "linux.sh");
  const args = [
    scriptSource,
    "--non-interactive",
    "--native",
    "--install-dir",
    input.root,
    "--service-name",
    input.serviceName,
  ];
  if (input.channel === "releases" && tag) args.push("--version", tag);
  if (input.channel === "commits" && input.commit) args.push("--commit", input.commit);
  return {
    kind: "native",
    platform,
    command: "/bin/bash",
    args,
    scriptSource,
    logFile,
    unitName,
  };
}

export async function readInstallerUpdateLog(dataDir: string, limit = 80, jobId?: string) {
  try {
    const text = await readFile(installerUpdateLogPath(dataDir), "utf8");
    const lines = (jobId ? installerLogForJob(text, jobId) : text).split(/\r?\n/).filter((line) => line.trim());
    // Preserve identity when displaying the tail of a long build.
    if (jobId && lines.length > limit) {
      const evidence = lines.filter((line) => /^\[metis-update-(?:pid|exit):/.test(line) || installerLogIndicatesSuccess(line) || installerLogIndicatesFailure(line));
      return [lines[0], ...evidence, ...lines.slice(-limit)];
    }
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

export async function installerUpdateIsRunning(serviceName: string, platform: NodeJS.Platform = process.platform) {
  if (platform !== "linux") return false;
  const unit = installerUpdateUnitName(serviceName);
  try {
    const { stdout } = await execFileAsync("systemctl", ["show", "-p", "ActiveState", "--value", unit], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    const state = stdout.trim();
    return state === "active" || state === "activating";
  } catch {
    return false;
  }
}

async function flushNewLogLines(file: string, offset: { bytes: number }, log: (message: string) => void) {
  try {
    const handle = await open(file, "r");
    try {
      const stat = await handle.stat();
      if (stat.size <= offset.bytes) return;
      const length = Number(stat.size - offset.bytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset.bytes);
      offset.bytes = Number(stat.size);
      for (const line of buffer.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) log(line);
      }
    } finally {
      await handle.close();
    }
  } catch {
    // The log file appears after systemd-run starts.
  }
}

async function copyScriptForUpdate(source: string, dataDir: string) {
  const dest = installerUpdateScriptPath(dataDir, source);
  await mkdir(dataDir, { recursive: true });
  await copyFile(source, dest);
  return dest;
}

function parseSystemctlShow(stdout: string) {
  const values: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    values[line.slice(0, sep)] = line.slice(sep + 1).trim();
  }
  return values;
}

async function runSystemdInstaller(plan: InstallerUpdatePlan, args: string[], root: string, log: (message: string) => void) {
  const unit = plan.unitName;
  if (!unit) throw new Error("Linux installer updates require a systemd unit name.");
  log(`Starting installer via systemd-run (${unit}).`);
  if (await installerUpdateIsRunning(unit.slice(0, -INSTALLER_UPDATE_UNIT_SUFFIX.length))) {
    throw new Error("An installer update is already running.");
  }
  try {
    await execFileAsync("systemctl", ["reset-failed", unit], { timeout: 15_000, maxBuffer: 256 * 1024 });
  } catch {
    // No previous failed unit.
  }
  await execFileAsync("systemd-run", [
    `--unit=${unit}`,
    "--no-block",
    "--description=Metis AI installer update",
    `--property=StandardOutput=append:${plan.logFile}`,
    `--property=StandardError=append:${plan.logFile}`,
    "--property=PrivateTmp=no",
    ...installerSystemdEnvironment(process.env, root),
    ...installerExitCommand(plan, args),
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });

  const offset = { bytes: 0 };
  const deadline = Date.now() + 50 * 60_000;
  while (Date.now() < deadline) {
    await flushNewLogLines(plan.logFile, offset, log);
    const { stdout } = await execFileAsync("systemctl", [
      "show",
      "-p",
      "ActiveState",
      "-p",
      "Result",
      "-p",
      "ExecMainStatus",
      unit,
    ], { timeout: 5_000, maxBuffer: 64 * 1024 });
    const status = parseSystemctlShow(stdout);
    const active = status.ActiveState || "";
    const result = status.Result || "";
    const code = status.ExecMainStatus || "";
    if (active === "failed" || result === "failed" || (result === "exit-code" && code !== "0")) {
      await flushNewLogLines(plan.logFile, offset, log);
      const logText = await readFile(plan.logFile, "utf8").catch(() => "");
      const last = logText.trim().split(/\r?\n/).filter(Boolean).at(-1);
      throw new Error(
        `Installer update failed (systemd result=${result || active}, status=${code || "unknown"}).${last ? ` ${last}` : ""}`,
      );
    }
    if (active === "inactive" || active === "dead") {
      await flushNewLogLines(plan.logFile, offset, log);
      const logText = await readFile(plan.logFile, "utf8").catch(() => "");
      if (code && code !== "0") throw new Error(`Installer update exited with status ${code}.`);
      const currentLog = logText.slice(Math.max(0, logText.lastIndexOf("[metis-update-job:")));
      if (installerExitCode(currentLog) !== 0 && installerLogIndicatesFailure(currentLog)) {
        const last = logText.trim().split(/\r?\n/).filter(Boolean).at(-1) || "see installer log";
        throw new Error(`Installer update failed. ${last}`);
      }
      if (!code && !logText.trim()) {
        throw new Error("Installer update finished without a systemd status or log.");
      }
      log("Installer finished.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Installer update timed out after 50 minutes.");
}

export function installerProcessIsRunning(text: string): boolean {
  if (installerExitCode(text) !== undefined) return false;
  const matches = [...text.matchAll(/^\[metis-update-pid:(\d+)\]\r?$/gm)];
  const pid = Number(matches.at(-1)?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function installerExitCode(text: string): number | undefined {
  const matches = [...text.matchAll(/^\[metis-update-exit:(\d+)\]\r?$/gm)];
  return matches.length ? Number(matches.at(-1)![1]) : undefined;
}

// Output must survive the app process that the installer replaces.
export function installerExitCommand(plan: InstallerUpdatePlan, args: string[]): string[] {
  if (plan.platform === "win32") {
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const script = `[IO.File]::AppendAllText(${quote(plan.logFile)}, ("[metis-update-pid:" + $PID + "]" + [Environment]::NewLine)); & ${[plan.command, ...args].map(quote).join(" ")}; $updateExit = $LASTEXITCODE; [IO.File]::AppendAllText(${quote(plan.logFile)}, ([Environment]::NewLine + "[metis-update-exit:" + $updateExit + "]" + [Environment]::NewLine)); exit $updateExit`;
    return [plan.command, "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  }
  return ["/bin/bash", "-c", 'printf "[metis-update-pid:%s]\\n" "$$"; "$@"; update_exit=$?; printf "\\n[metis-update-exit:%s]\\n" "$update_exit"; exit "$update_exit"', "--", plan.command, ...args];
}

export async function runSpawnedInstaller(plan: InstallerUpdatePlan, args: string[], log: (message: string) => void) {
  const handle = await open(plan.logFile, "a", 0o600);
  try {
    const [command, ...wrappedArgs] = installerExitCommand(plan, args);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, wrappedArgs, {
        detached: true,
        stdio: ["ignore", handle.fd, handle.fd],
        env: process.env,
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Installer update exited with status ${code ?? "unknown"}.`));
      });
    });
    log("Installer finished.");
  } finally {
    await handle.close();
  }
}

export async function runInstallerUpdate(
  input: InstallerUpdateInput,
  log: (message: string) => void,
): Promise<InstallerUpdateResult> {
  const plan = buildInstallerUpdatePlan(input);
  await mkdir(input.dataDir, { recursive: true });
  const script = await copyScriptForUpdate(plan.scriptSource, input.dataDir);
  const args = plan.args.map((value) => (value === plan.scriptSource ? script : value));
  log(`Running ${plan.kind} installer: ${plan.command} ${args.join(" ")}`);
  if (plan.unitName && plan.platform === "linux") {
    await runSystemdInstaller(plan, args, input.root, log);
  } else {
    await runSpawnedInstaller(plan, args, log);
  }
  return {
    tag: input.tag || (input.channel === "commits" ? "master" : "latest"),
    method: "installer",
    asset: path.basename(plan.scriptSource),
  };
}
