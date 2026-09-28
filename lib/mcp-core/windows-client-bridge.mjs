const windowsClientPattern = /windows/i;

function psQuote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function psEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function selectWindowsClient(clients, requestedId) {
  const online = (Array.isArray(clients) ? clients : []).filter((client) =>
    client && client.status === "online" && windowsClientPattern.test(String(client.os || ""))
  );
  if (requestedId) {
    const chosen = online.find((client) => client.id === requestedId);
    if (!chosen) throw new Error(`Windows client ${requestedId} is not online for this account`);
    return chosen;
  }
  if (online.length === 1) return online[0];
  if (!online.length) throw new Error("No Windows client is online for this account");
  throw new Error("More than one Windows client is online; pass client_id to choose one");
}

export function windowsClientCommand(job) {
  const action = job.action || "run";
  if (action !== "run" && action !== "spawn") throw new Error("Unsupported Windows desktop job action");
  const command = job.command;
  if (!(typeof command === "string" && command.trim()) &&
      !(Array.isArray(command) && command.length && command.every((part) => typeof part === "string"))) {
    throw new Error("Windows desktop job requires a command string or argument array");
  }
  const env = job.env && typeof job.env === "object" ? job.env : {};
  const assignments = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
    return `$env:${key}=${psQuote(value)}`;
  });
  const invocation = typeof command === "string"
    ? `& cmd.exe /d /s /c ${psQuote(command)}`
    : `& ${command.map(psQuote).join(" ")}`;
  const pathSetup = `$env:PATH='C:\\Program Files\\nodejs;'+$env:APPDATA+'\\npm;'+$env:LOCALAPPDATA+'\\Microsoft\\WindowsApps;'+$env:PATH`;
  const runScript = `$ErrorActionPreference='Stop'; ${pathSetup}; ${assignments.join("; ")}; ${invocation}; exit $LASTEXITCODE`;
  if (action === "run") return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${psEncoded(runScript)}`;
  const spawnScript = `$ErrorActionPreference='Stop'; ${assignments.join("; ")}; $p=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${psEncoded(runScript)}') -WorkingDirectory (Get-Location).Path -PassThru; $p.Id`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${psEncoded(spawnScript)}`;
}

export function windowsScreenshotScript(command) {
  if (!Array.isArray(command) || !command.length) throw new Error("Screenshot command is required");
  const invoke = command.map(psQuote).join(" ");
  return `$ErrorActionPreference='Stop';
$raw=(& ${invoke} | Out-String).Trim();
if($LASTEXITCODE -ne 0){throw "winapp screenshot failed: $raw"};
$data=$raw | ConvertFrom-Json;
function FindPng($value) {
  if($null -eq $value){return $null}
  if($value -is [string]){
    if($value.EndsWith('.png',[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::IsPathRooted($value)){return $value}
    return $null
  }
  if($value -is [System.Collections.IDictionary]){
    foreach($item in $value.Values){$found=FindPng $item;if($found){return $found}}
    return $null
  }
  if($value -is [array]){
    foreach($item in $value){$found=FindPng $item;if($found){return $found}}
    return $null
  }
  foreach($property in $value.PSObject.Properties){$found=FindPng $property.Value;if($found){return $found}}
  return $null
}
$png=FindPng $data;
if(-not $png){throw 'Screenshot completed but no PNG path was found'}
[pscustomobject]@{screenshot=$png;command_result=$data;image_base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($png))} | ConvertTo-Json -Depth 20 -Compress`;
}

export function windowsClientJobResult(job, result) {
  const stdout = String(result?.stdout || "");
  const stderr = String(result?.stderr || "");
  if ((job.action || "run") === "spawn") {
    const pid = Number(stdout.trim());
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Windows desktop job did not return a process ID: ${stdout || stderr}`);
    return { ok: true, action: "spawn", pid };
  }
  return {
    ok: Number(result?.exitCode ?? 0) === 0,
    action: "run",
    exit_code: Number(result?.exitCode ?? 0),
    stdout,
    stderr,
  };
}
