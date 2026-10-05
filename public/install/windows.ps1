param(
  [Parameter(Position=0)][string]$Command = "",
  [string]$InstallDir = "",
  [string]$RepoUrl = $env:METIS_AI_REPO_URL,
  [string]$DataDir = "",
  [string]$AgentCwd = "",
  [string]$Port = "3100",
  [Alias("Host")][string]$BindHost = "127.0.0.1",
  [string]$McpPort = "8787",
  [string]$Username = "admin",
  [string]$Password = "",
  [string]$PasswordFile = "",
  [string]$ServiceName = "MetisAI",
  [string]$PublicUrl = "",
  [string]$Version = "",
  [string]$Commit = "",
  [switch]$NonInteractive,
  [switch]$SkipRuntimeInstall,
  [switch]$Native,
  [switch]$Docker,
  [switch]$ReplaceExisting,
  [switch]$DryRun,
  [switch]$Help,
  [switch]$Yes,
  [switch]$KeepData,
  [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
if ($Help) {
  @"
Usage:
  windows.ps1                         Guided installation
  windows.ps1 -NonInteractive

This script must be invoked with powershell -File. Do not pipe it to iex;
use install.ps1 for the one-line installer.

Options: -InstallDir, -DataDir, -AgentCwd, -Port, -Host, -McpPort,
         -Username, -Password, -PasswordFile, -ServiceName, -PublicUrl, -Version, -Commit
         -NonInteractive, -SkipRuntimeInstall, -Native, -Docker, -ReplaceExisting, -DryRun
         uninstall [-Yes] [-KeepData] [-InstallDir DIR]
"@ | Write-Host
  exit 0
}
if ($Command -eq "uninstall") {
  $selfDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $uninstaller = Join-Path $selfDir "uninstall.ps1"
  if (-not (Test-Path -LiteralPath $uninstaller)) {
    $uninstaller = Join-Path (Join-Path $selfDir "install") "uninstall.ps1"
  }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Could not find uninstall.ps1 next to windows.ps1." }
  $forward = @()
  if ($InstallDir) { $forward += @("-InstallDir", $InstallDir) }
  if ($ServiceName) { $forward += @("-ServiceName", $ServiceName) }
  if ($KeepData) { $forward += "-KeepData" }
  if ($RemoveData) { $forward += "-RemoveData" }
  if ($DryRun) { $forward += "-DryRun" }
  if ($Yes) { $forward += "-Yes" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uninstaller @forward
  exit $LASTEXITCODE
}
if (-not $RepoUrl) { $RepoUrl = "https://github.com/f1shyondrugs/metis-ai.git" }
if (-not $InstallDir) {
  $InstallDir = if ($env:METIS_AI_INSTALL_DIR) { $env:METIS_AI_INSTALL_DIR } else { Join-Path $HOME "metis-ai" }
}

function Ask([string]$Prompt, [string]$Default) {
  if ($NonInteractive) { return $Default }
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}
function Get-DefaultPublicHost {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { return $ip }
  return "127.0.0.1"
}
function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name is required." }
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [Environment]::GetEnvironmentVariable("Path", "User")
}
function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& $node.Source -p "process.versions.node.split('.')[0]")) } catch { return 0 }
}
function Confirm-Install([string]$Name) {
  if ($NonInteractive) { return $true }
  $answer = Read-Host "$Name is missing or too old. Install/update it automatically now? (Y/n)"
  return [string]::IsNullOrWhiteSpace($answer) -or $answer -match "^(y|yes)$"
}

if ($PasswordFile) {
  if (-not (Test-Path -LiteralPath $PasswordFile -PathType Leaf)) { throw "Password file is not readable: $PasswordFile" }
  $Password = (Get-Content -LiteralPath $PasswordFile -Raw).TrimEnd("`r", "`n")
}

$port = $Port
$mcpPort = $McpPort
$username = $Username
$serviceName = $ServiceName
$dataDir = if ($DataDir) { $DataDir } else { Join-Path $InstallDir "data" }
$agentCwd = if ($AgentCwd) { $AgentCwd } else { $HOME }

if (-not $NonInteractive) {
  $InstallDir = Ask "Installation directory" $InstallDir
  $dataDir = if ($DataDir) { $DataDir } else { Join-Path $InstallDir "data" }
  $aiChatHost = if ($BindHost) { $BindHost } else { "127.0.0.1" }
} else {
  $aiChatHost = if ($BindHost) { $BindHost } else { "127.0.0.1" }
}
$passwordPlain = $Password
if ($Password -and $Password.Length -lt 8) { throw "Password must contain at least 8 characters." }
if ($Docker -and $Native) { throw "Use either -Docker or -Native, not both." }
# Account creation takes place in the browser, as on Linux.

$publicHost = if ($aiChatHost -eq "0.0.0.0") { Get-DefaultPublicHost } else { "127.0.0.1" }
$publicUrl = if ($PublicUrl) { $PublicUrl } else { "http://$publicHost`:$port" }

$portNumber = 0
$mcpPortNumber = 0
if (-not [int]::TryParse($port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
  throw "Web port must be a number between 1 and 65535."
}
if (-not [int]::TryParse($mcpPort, [ref]$mcpPortNumber) -or $mcpPortNumber -lt 1 -or $mcpPortNumber -gt 65535) {
  throw "MCP port must be a number between 1 and 65535."
}
if ($port -eq $mcpPort) { throw "Web and MCP ports must be different." }
if ($serviceName -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') {
  throw "Service name may contain letters, numbers, underscores and hyphens."
}

$existingServiceDir = ""
$appKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$serviceName"
try {
  $existingServiceDir = (Get-ItemProperty -LiteralPath $appKey -ErrorAction Stop).InstallLocation
} catch {}
try {
  $existingRun = (Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "$serviceName-app" -ErrorAction Stop)."$serviceName-app"
  if ($existingRun -and -not $existingServiceDir) {
    $cmdPath = [string]$existingRun.Trim().Trim('"')
    if (Test-Path -LiteralPath $cmdPath) { $existingServiceDir = Split-Path -Parent $cmdPath }
  }
} catch {}

if ($DryRun) {
  Write-Host "Dry run; no files or services will be changed."
  Write-Host "  os:            windows"
  Write-Host "  install dir:   $InstallDir"
  Write-Host "  data dir:      $dataDir"
  Write-Host "  agent cwd:     $agentCwd"
  Write-Host "  bind:          ${aiChatHost}:${port}"
  Write-Host "  mcp port:      $mcpPort"
  Write-Host "  service name:  $serviceName"
  Write-Host "  public url:    $publicUrl"
  Write-Host "  username:      $username"
  Write-Host "  native:        $Native"
  if ($existingServiceDir) { Write-Host "  existing:      $serviceName-app at $existingServiceDir" } else { Write-Host "  existing:      none" }
  exit 0
}

function Test-OwnedDockerPort([int]$Number) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  try {
    $ownedPorts = & docker ps --filter "label=com.docker.compose.project.working_dir=$InstallDir" --format "{{.Ports}}" 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    return [bool](@($ownedPorts | Where-Object { $_ -match ":$Number->" }).Count)
  } catch { return $false }
}

function Assert-AvailablePorts([string]$WebPort, [string]$GatewayPort) {
  if ($WebPort -eq $GatewayPort) { throw "Web and MCP ports must be different." }
  foreach ($entry in @(@{ Name = "Web"; Port = $WebPort }, @{ Name = "MCP"; Port = $GatewayPort })) {
    $number = 0
    if (-not [int]::TryParse($entry.Port, [ref]$number) -or $number -lt 1 -or $number -gt 65535) {
      throw "$($entry.Name) port must be between 1 and 65535."
    }
    if (Test-OwnedDockerPort $number) { continue }
    $owners = @(Get-NetTCPConnection -State Listen -LocalPort $number -ErrorAction SilentlyContinue)
    foreach ($owner in $owners) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.OwningProcess)" -ErrorAction SilentlyContinue
      $owned = $proc -and $proc.CommandLine -and
        $proc.CommandLine.IndexOf([IO.Path]::GetFullPath($InstallDir) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $proc.CommandLine -match 'server\.mjs|gateway-core\.mjs|MetisHost\.exe'
      # Legacy node children may use relative paths; verify their PowerShell parent.
      if (-not $owned -and $proc) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
        $owned = $parent -and $parent.CommandLine -and
          $parent.CommandLine.IndexOf([IO.Path]::GetFullPath($InstallDir) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
          $parent.CommandLine -match 'run-service\.ps1'
      }
      if (-not $owned) {
        throw "$($entry.Name) port $number is already occupied by $($proc.Name) (PID $($owner.OwningProcess)). Metis has not been started. Choose a free -Port / -McpPort or close the conflicting application (for example OpenWebUI)."
      }
    }
    if ($owners.Count -eq 0) {
      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $number)
      $listener.Server.ExclusiveAddressUse = $true
      try { $listener.Start() } catch { throw "$($entry.Name) port $number cannot be bound. Choose a free -Port / -McpPort. $($_.Exception.Message)" }
      finally { $listener.Stop() }
    }
  }
}

$script:ReplaceDataStash = $null
$script:ReplaceEnvStash = $null

function Get-EnvStashPath([string]$Dir) {
  $full = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
  return Join-Path (Split-Path -Parent $full) (".$(Split-Path -Leaf $full).metis-keep-env")
}

function Get-EnvKey([string]$Line) {
  $trim = $Line.Trim()
  if (-not $trim -or $trim.StartsWith('#')) { return "" }
  $idx = $trim.IndexOf('=')
  if ($idx -lt 1) { return "" }
  return $trim.Substring(0, $idx)
}

function Save-ExistingEnv([string]$Dir) {
  $src = Join-Path $Dir ".env"
  if (-not (Test-Path -LiteralPath $src)) { return }
  $script:ReplaceEnvStash = Get-EnvStashPath $Dir
  Copy-Item -LiteralPath $src -Destination $script:ReplaceEnvStash -Force
  Write-Host "Kept previous .env at $($script:ReplaceEnvStash)"
}

function Adopt-EnvStash([string]$Dir) {
  if ($script:ReplaceEnvStash -and (Test-Path -LiteralPath $script:ReplaceEnvStash)) { return }
  $candidate = Get-EnvStashPath $Dir
  if (Test-Path -LiteralPath $candidate) {
    $script:ReplaceEnvStash = $candidate
    return
  }
  Save-ExistingEnv $Dir
}

function Merge-PreservedEnv([string]$Dest) {
  if (-not $script:ReplaceEnvStash -or -not (Test-Path -LiteralPath $script:ReplaceEnvStash) -or -not (Test-Path -LiteralPath $Dest)) { return }
  $structural = @{}
  foreach ($key in @(
    'AI_CHAT_ROOT', 'AI_CHAT_INSTALL_DIR', 'METIS_NODE_BIN', 'METIS_NODE_HOME',
    'CHAT_DATA_DIR', 'METIS_DATA_DIR', 'AGENT_CWD', 'METIS_WORKSPACE',
    'AI_CHAT_MCP_STATE_DIR', 'METIS_DOCKER', 'AI_CHAT_SERVICE_NAME'
  )) { $structural[$key] = $true }
  $oldLines = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $script:ReplaceEnvStash) {
    $k = Get-EnvKey $line
    if ($k) { $oldLines[$k] = $line }
  }
  $used = @{}
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($line in Get-Content -LiteralPath $Dest) {
    $k = Get-EnvKey $line
    if ($k -and -not $structural.ContainsKey($k) -and $oldLines.Contains($k)) {
      $out.Add([string]$oldLines[$k])
      $used[$k] = $true
    } else {
      $out.Add($line)
      if ($k) { $used[$k] = $true }
    }
  }
  foreach ($k in $oldLines.Keys) {
    if (-not $used.ContainsKey($k) -and -not $structural.ContainsKey($k)) {
      $out.Add([string]$oldLines[$k])
    }
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($Dest, (($out -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine), $utf8NoBom)
  Remove-Item -LiteralPath $script:ReplaceEnvStash -Force
  $script:ReplaceEnvStash = $null
  Write-Host "Merged previous .env into $Dest (old values kept, new keys added)."
}

function Get-ExistingDataDir([string]$Dir) {
  $envFile = Join-Path $Dir ".env"
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^CHAT_DATA_DIR=' } | Select-Object -First 1
    if ($line) {
      $value = $line.Substring('CHAT_DATA_DIR='.Length).Trim().Trim('"')
      if ($value) { return $value }
    }
  }
  $manifestPath = Join-Path $Dir ".metis-ai-install.json"
  if (Test-Path -LiteralPath $manifestPath) {
    try {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      if ($manifest.dataDir) { return [string]$manifest.dataDir }
    } catch {}
  }
  $nested = Join-Path $Dir "data"
  if (Test-Path -LiteralPath $nested) { return $nested }
  return ""
}

function Test-PathInside([string]$Inner, [string]$Outer) {
  $innerFull = [IO.Path]::GetFullPath($Inner).TrimEnd('\')
  $outerFull = [IO.Path]::GetFullPath($Outer).TrimEnd('\')
  return ($innerFull -eq $outerFull) -or $innerFull.StartsWith($outerFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Uninstall-DetectedInstall([string]$Dir) {
  if (-not $Dir -or $Dir -eq [IO.Path]::GetPathRoot($Dir) -or $Dir -eq $HOME) {
    throw "Refusing to uninstall an unsafe install directory: $Dir"
  }
  Write-Host "Uninstalling existing Metis AI at $Dir (data kept)."
  $data = Get-ExistingDataDir $Dir
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  foreach ($suffix in @("app", "worker", "mcp")) {
    $task = "$serviceName-$suffix"
    Remove-ItemProperty -LiteralPath $runKey -Name $task -ErrorAction SilentlyContinue
    cmd.exe /c "schtasks /Delete /TN `"$task`" /F >nul 2>&1" | Out-Null
  }
  $rootNorm = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -and $_.CommandLine.IndexOf($rootNorm, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Save-ExistingEnv $Dir
  if ($data -and (Test-Path -LiteralPath $data) -and (Test-PathInside $data $Dir)) {
    $parent = Split-Path -Parent $rootNorm
    $script:ReplaceDataStash = Join-Path $parent (".$(Split-Path -Leaf $rootNorm).metis-keep-data")
    if (Test-Path -LiteralPath $script:ReplaceDataStash) { Remove-Item -LiteralPath $script:ReplaceDataStash -Recurse -Force }
    Move-Item -LiteralPath $data -Destination $script:ReplaceDataStash
    Write-Host "Kept nested data at $($script:ReplaceDataStash)"
  }
  Start-Sleep -Seconds 1
  if (Test-Path -LiteralPath $rootNorm) {
    cmd.exe /c "rmdir /s /q `"\\?\$rootNorm`"" | Out-Null
  }
}

function Restore-StashedData([string]$Dest) {
  if (-not $script:ReplaceDataStash -or -not (Test-Path -LiteralPath $script:ReplaceDataStash)) { return }
  $destParent = Split-Path -Parent $Dest
  if ($destParent) { New-Item -ItemType Directory -Force -Path $destParent | Out-Null }
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
  Move-Item -LiteralPath $script:ReplaceDataStash -Destination $Dest
  $script:ReplaceDataStash = $null
  Write-Host "Restored kept data to $Dest"
}

if ($existingServiceDir) {
  $existingFull = [IO.Path]::GetFullPath($existingServiceDir)
  $installFull = [IO.Path]::GetFullPath($InstallDir)
  $same = $existingFull -eq $installFull
  $choice = ""
  if ($ReplaceExisting) {
    $choice = "r"
  } elseif ($NonInteractive) {
    if ($same) { $choice = "u" }
  } else {
    Write-Host "Existing Metis AI detected."
    Write-Host "  service:   $serviceName-app"
    Write-Host "  directory: $existingServiceDir"
    Write-Host "[u] Upgrade that install"
    Write-Host "[r] Replace it (uninstall, keep data, then continue)"
    Write-Host "[n] Uninstall and exit (keeps data)"
    Write-Host "[a] Abort"
    $choice = Read-Host "Choice [u/r/n/a]"
  }
  switch -Regex ($choice) {
    '^[rR]$' {
      $InstallDir = $existingServiceDir
      if (-not $DataDir) { $dataDir = Join-Path $InstallDir "data" }
      Uninstall-DetectedInstall $InstallDir
      $existingServiceDir = ""
    }
    '^[uU]$' {
      $InstallDir = $existingServiceDir
      Write-Host "Existing Metis AI install detected: $serviceName-app is registered in $InstallDir. Upgrading in place."
    }
    '^[aA]$' {
      Write-Host "Aborted."
      exit 0
    }
    '^[nN]$' {
      $self = $MyInvocation.MyCommand.Path
      $forward = @("uninstall", "-InstallDir", $existingServiceDir, "-Yes", "-KeepData")
      if ($DryRun) { $forward += "-DryRun" }
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $self @forward
      exit $LASTEXITCODE
    }
    default {
      throw "Metis AI is already installed as $serviceName-app in $existingServiceDir. Re-run and choose upgrade/replace/uninstall, or pass -ReplaceExisting."
    }
  }
}

# Check effective preserved ports before dependency installation or building.
$preflightEnv = Join-Path $InstallDir ".env"
if (Test-Path -LiteralPath $preflightEnv) {
  foreach ($line in Get-Content -LiteralPath $preflightEnv) {
    if ($line -match '^PORT=(.+)$') { $port = $Matches[1].Trim().Trim('"') }
    if ($line -match '^MCP_PORT=(.+)$') { $mcpPort = $Matches[1].Trim().Trim('"') }
  }
}
if ($Native -and ((Test-OwnedDockerPort ([int]$port)) -or (Test-OwnedDockerPort ([int]$mcpPort)))) {
  throw "This installation is running in Docker. Keep its current mode for upgrade, or stop its Compose stack before migrating with -Native."
}
if ($Docker -and $existingServiceDir) {
  $oldManifest = Join-Path $InstallDir ".metis-ai-install.json"
  if ((Test-Path -LiteralPath $oldManifest) -and (Get-Content -LiteralPath $oldManifest -Raw | ConvertFrom-Json).installMethod -eq "native") {
    throw "This is a native installation. Upgrade without -Docker; migrate its runtime separately."
  }
}
Assert-AvailablePorts $port $mcpPort
$publicUrl = if ($PublicUrl) { $PublicUrl } else { "http://$publicHost`:$port" }

$useDocker = [bool]$Docker
$previousManifest = Join-Path $InstallDir ".metis-ai-install.json"
if (-not $Native -and -not $Docker -and (Test-Path -LiteralPath $previousManifest)) {
  $useDocker = (Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json).installMethod -eq "docker"
}
if ($useDocker) {
  Require-Command docker
  & docker info | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop or omit -Docker for native installation." }
  & docker compose version | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose is required with -Docker." }
}

if (-not $SkipRuntimeInstall) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required to install Git and Node.js automatically."
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Confirm-Install "Git")) { throw "git is required." }
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements
  }
  if (-not $useDocker -and (Get-NodeMajor) -lt 22) {
    if (-not (Confirm-Install "Node.js 22 or newer")) { throw "Node.js 22 or newer is required." }
    winget install --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
  }
  Refresh-Path
}
Require-Command git
if (-not $useDocker -and (Get-NodeMajor) -lt 22) { throw "Node.js 22 or newer is required." }

if (Test-Path (Join-Path $InstallDir ".git")) {
  git -C $InstallDir fetch --force origin
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch Metis AI commits." }
  git -C $InstallDir fetch --tags --force
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch Metis AI release tags." }
} elseif ((Test-Path $InstallDir) -and (Get-ChildItem -Force $InstallDir | Select-Object -First 1)) {
  throw "Installation directory exists and is not a Metis AI checkout: $InstallDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  git clone $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "Could not clone Metis AI." }
}
if ($Commit) {
  if ($Commit -notmatch '^[0-9a-fA-F]{7,40}$') { throw "Commit must be a git SHA." }
  if ($Version -and $Version -ne "latest") { throw "Use either -Version or -Commit, not both." }
  $updateRef = $Commit
  git -C $InstallDir checkout --force -B master $updateRef
} elseif ($Version -and $Version -ne "latest") {
  if ($Version -notmatch '^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    throw "Version must be latest or a v-prefixed SemVer tag, for example v1.0.0."
  }
  $updateRef = $Version
  git -C $InstallDir checkout --force $updateRef
} else {
  $updateRef = "origin/master"
  git -C $InstallDir checkout --force -B master $updateRef
}
if ($LASTEXITCODE -ne 0) { throw "Could not check out Metis AI $updateRef." }
# Replace tracked local edits and divergent commits, preserving ignored install state.
git -C $InstallDir reset --hard $updateRef
if ($LASTEXITCODE -ne 0) { throw "Could not reset Metis AI to $updateRef." }
Restore-StashedData $dataDir

function Get-PnpmCommand {
  $existing = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if ($existing) { return [string]$existing }
  $runtimePrefix = Join-Path $InstallDir ".runtime"
  $candidates = @(
    (Join-Path $runtimePrefix "pnpm.cmd"),
    (Join-Path $runtimePrefix "node_modules\.bin\pnpm.cmd")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return [string]$candidate }
  }
  $npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npmCommand) { throw "npm is required to install pnpm without Administrator access." }
  New-Item -ItemType Directory -Force -Path $runtimePrefix | Out-Null
  & $npmCommand install --global --prefix $runtimePrefix pnpm@9 | Out-Null
  $env:Path = "$runtimePrefix;$runtimePrefix\node_modules\.bin;" + $env:Path
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return [string]$candidate }
  }
  $refreshed = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if ($refreshed) { return [string]$refreshed }
  throw "pnpm is required."
}
$pnpmCommand = $null
$nodeBin = $null
if (-not $useDocker) {
  $pnpmCommand = [string](Get-PnpmCommand)
  $nodeBin = (Get-Command node).Source
}

$randomHex = { -join (1..32 | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) }) }
$chatPassword = & $randomHex
$secretsKey = & $randomHex
$mcpToken = & $randomHex

New-Item -ItemType Directory -Force -Path $dataDir, $agentCwd | Out-Null
Adopt-EnvStash $InstallDir
$dockerEnv = ""
if ($useDocker) {
  $dockerEnv = @"
METIS_WORKSPACE=$agentCwd
METIS_DATA_DIR=$dataDir
AI_CHAT_BIND=$aiChatHost
METIS_DOCKER=1
AGENT_CWD=/workspace
CHAT_DATA_DIR=/data
METIS_AI_BOOTSTRAP_USERNAME=$username
METIS_AI_BOOTSTRAP_PASSWORD=$passwordPlain
METIS_AI_BOOTSTRAP_OPTIONAL=1
"@
} else {
  $hostOsUsername = (& $nodeBin -p "require('node:os').userInfo().username").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $hostOsUsername) { throw "Could not resolve the Windows installation account." }
  $dockerEnv = "METIS_NODE_BIN=$nodeBin" + [Environment]::NewLine + "METIS_HOST_OS_USERNAME=$hostOsUsername"
}
$envLines = @"
APP_NAME=Metis AI
PORT=$port
AI_CHAT_HOST=$aiChatHost
CHAT_USERNAME=$username
CHAT_PASSWORD=$chatPassword
CHAT_DATA_DIR=$dataDir
AGENT_CWD=$agentCwd
AI_CHAT_ROOT=$InstallDir
AI_CHAT_INSTALL_DIR=$InstallDir
AI_CHAT_PUBLIC_URL=$publicUrl
AI_CHAT_INTERNAL_ORIGIN=http://127.0.0.1:$port
AI_CHAT_SERVICE_NAME=$serviceName
AI_CHAT_WORKER_CONCURRENCY=25
AI_CHAT_MCP_STATE_DIR=$(Join-Path $dataDir "mcp-state")
AI_CHAT_INTERNAL_URL=http://127.0.0.1:$port/api/internal/mcp-question
AI_CHAT_WORKSPACE_URL=http://127.0.0.1:$port/api/internal/mcp-workspace
AI_CHAT_CHAT_URL=http://127.0.0.1:$port/api/internal/mcp-chat
AI_CHAT_NOTES_URL=http://127.0.0.1:$port/api/internal/mcp-notes
AI_CHAT_MEMORY_URL=http://127.0.0.1:$port/api/internal/mcp-memory
AI_CHAT_BROWSER_URL=http://127.0.0.1:$port/api/internal/browser
AI_CHAT_AGENT_STATE_URL=http://127.0.0.1:$port/api/internal/mcp-agent-state
AI_CHAT_SUBAGENT_URL=http://127.0.0.1:$port/api/internal/mcp-subagent
AI_CHAT_AUTOMATION_URL=http://127.0.0.1:$port/api/internal/mcp-automation
AI_CHAT_FILE_URL=http://127.0.0.1:$port/api/internal/mcp-file
AI_CHAT_SECRETS_KEY=$secretsKey
MCP_PORT=$mcpPort
MCP_PUBLIC_URL=http://127.0.0.1:$mcpPort
MCP_BEARER_TOKEN=$mcpToken
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
$dockerEnv
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $InstallDir ".env"), $envLines.Trim() + [Environment]::NewLine, $utf8NoBom)
Merge-PreservedEnv (Join-Path $InstallDir ".env")
$mergedEnv = Join-Path $InstallDir ".env"
foreach ($line in Get-Content -LiteralPath $mergedEnv) {
  $k = Get-EnvKey $line
  if (-not $k) { continue }
  $v = $line.Substring($k.Length + 1).Trim().Trim('"')
  if ($k -eq 'PORT' -and $v -match '^[0-9]+$') { $port = $v }
  if ($k -eq 'MCP_PORT' -and $v -match '^[0-9]+$') { $mcpPort = $v }
  if ($k -eq 'AI_CHAT_PUBLIC_URL') { $publicUrl = $v }
}

Assert-AvailablePorts $port $mcpPort

if ($useDocker) {
  $reloadPs1 = @"
# Apply .env and published-port changes. `docker compose restart` keeps the old config.
Set-Location -LiteralPath $PSScriptRoot
Remove-Item Env:PORT,Env:MCP_PORT,Env:AI_CHAT_HOST,Env:AI_CHAT_BIND,Env:METIS_DATA_DIR,Env:METIS_WORKSPACE,Env:METIS_IMAGE -ErrorAction SilentlyContinue
docker compose --env-file .env up -d --remove-orphans --force-recreate
"@
  Set-Content -LiteralPath (Join-Path $InstallDir "reload.ps1") -Value $reloadPs1.Trim() -Encoding utf8
  Push-Location $InstallDir
  try {
    Remove-Item Env:PORT,Env:MCP_PORT,Env:AI_CHAT_HOST,Env:AI_CHAT_BIND,Env:METIS_DATA_DIR,Env:METIS_WORKSPACE,Env:METIS_IMAGE -ErrorAction SilentlyContinue
    docker compose --env-file .env up -d --build --remove-orphans
  } finally {
    Pop-Location
  }
} else {
Push-Location $InstallDir
try {
  $previousNodeEnv = $env:NODE_ENV
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  & $pnpmCommand install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
  $env:CHAT_DATA_DIR = $dataDir
  & node scripts/sync-provider-clis.mjs
  if ($LASTEXITCODE -ne 0) { throw "Provider CLI synchronization failed." }
  & $pnpmCommand exec playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "Browser installation failed." }
  $env:METIS_AI_BOOTSTRAP_USERNAME = $username
  $env:METIS_AI_BOOTSTRAP_PASSWORD = $passwordPlain
  $env:METIS_AI_BOOTSTRAP_OPTIONAL = "1"
  if ($passwordPlain) {
    & $pnpmCommand exec tsx scripts/bootstrap-user.ts
    if ($LASTEXITCODE -ne 0) { throw "User bootstrap failed." }
  }
  $previousDistDir = $env:NEXT_DIST_DIR
  $activeDistDir = ""
  foreach ($line in Get-Content -LiteralPath $mergedEnv) {
    if ($line -match '^NEXT_DIST_DIR=(.+)$') { $activeDistDir = $Matches[1].Trim().Trim('"') }
  }
  $nextDistDir = if ($activeDistDir -eq ".next-a") { ".next-b" } else { ".next-a" }
  $env:NEXT_DIST_DIR = $nextDistDir
  try {
    & $pnpmCommand build
    if ($LASTEXITCODE -ne 0) { throw "Production build failed; existing services were not restarted." }
  } finally {
    if ($null -ne $previousDistDir) { $env:NEXT_DIST_DIR = $previousDistDir } else { Remove-Item Env:NEXT_DIST_DIR -ErrorAction SilentlyContinue }
  }
  $runtimeEnv = @(Get-Content -LiteralPath $mergedEnv | Where-Object { $_ -notmatch '^NEXT_DIST_DIR=' })
  [IO.File]::WriteAllText($mergedEnv, ($runtimeEnv + "NEXT_DIST_DIR=$nextDistDir") -join [Environment]::NewLine, $utf8NoBom)
} finally {
  if ($null -ne $previousNodeEnv) { $env:NODE_ENV = $previousNodeEnv }
  Pop-Location
  Remove-Item Env:METIS_AI_BOOTSTRAP_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:METIS_AI_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:METIS_AI_BOOTSTRAP_OPTIONAL -ErrorAction SilentlyContinue
}

$runner = Join-Path $InstallDir "run-service.ps1"
@"
`$ErrorActionPreference = "Stop"
Get-Content -LiteralPath (Join-Path `$PSScriptRoot ".env") | Where-Object { `$_ -and -not `$_.StartsWith("#") } | ForEach-Object {
  `$pair = `$_ -split "=", 2
  if (`$pair.Count -eq 2) { [Environment]::SetEnvironmentVariable(`$pair[0].Trim([char]0xFEFF), `$pair[1], "Process") }
}
Set-Location `$PSScriptRoot
`$node = `$env:METIS_NODE_BIN
if (-not `$node -or -not (Test-Path -LiteralPath `$node)) { `$node = (Get-Command node).Source }
& `$node @args
"@ | Set-Content -LiteralPath $runner -Encoding ascii

}
# GUI host and hidden child processes never allocate a console.
$hostExe = Join-Path $InstallDir "MetisHost.exe"
$hostNew = Join-Path $InstallDir "MetisHost.new.exe"
$csc = Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
  $csc = Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $csc)) { throw "The Windows .NET Framework compiler is missing." }
$hostSource = Join-Path $InstallDir "MetisHost.cs"
@'
// Compiled by the installer with the Windows .NET Framework compiler (/target:winexe).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class MetisHost {
    static string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    static string logDir;
    static readonly object logLock = new object();
    static void Log(string name, string line) {
        if (line == null) return;
        lock (logLock) File.AppendAllText(Path.Combine(logDir, name + ".log"),
            DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
    }
    static Process Start(string exe, string args, string name) {
        var p = new Process();
        p.StartInfo = new ProcessStartInfo(exe, args) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        p.OutputDataReceived += (s, e) => Log(name, e.Data);
        p.ErrorDataReceived += (s, e) => Log(name, e.Data);
        p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine(); return p;
    }
    static string Env(string key, string fallback) {
        return Environment.GetEnvironmentVariable(key) ?? fallback;
    }
    static void CheckPort(string key, string fallback) {
        int port = int.Parse(Env(key, fallback));
        var listener = new TcpListener(IPAddress.Any, port);
        listener.Server.ExclusiveAddressUse = true;
        try { listener.Start(); }
        catch (SocketException) { throw new Exception("Port " + port + " (" + key +
            ") is occupied or unavailable. Close the conflicting application or change " + key + " in " + Path.Combine(root, ".env")); }
        finally { listener.Stop(); }
    }
    static void OpenBrowser() {
        string url = "http://127.0.0.1:" + Env("PORT", "3100");
        for (int i = 0; i < 60; i++) {
            try {
                var request = (HttpWebRequest)WebRequest.Create(url + "/api/status");
                request.Timeout = 2000; request.AllowAutoRedirect = false;
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream())) {
                    string body = reader.ReadToEnd();
                    if (body.Contains("\"authenticated\"") && body.Contains("\"worker\"") && body.Contains("\"mcp\"")) {
                        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); return;
                    }
                }
            } catch (WebException) {}
            Thread.Sleep(1000);
        }
        MessageBox.Show("Metis did not become ready at " + url + ". Check " + logDir +
            " for startup errors and port conflicts.", "Metis AI", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
    [STAThread]
    static void Main(string[] args) {
        bool open = Array.IndexOf(args, "--open") >= 0;
        bool stop = Array.IndexOf(args, "--stop") >= 0;
        try {
            foreach (string line in File.ReadAllLines(Path.Combine(root, ".env"))) {
                int pos = line.IndexOf('=');
                if (pos > 0 && !line.TrimStart().StartsWith("#"))
                    Environment.SetEnvironmentVariable(line.Substring(0, pos).Trim().Trim('\uFEFF'),
                        line.Substring(pos + 1).Trim().Trim('"'));
            }
            Environment.SetEnvironmentVariable("NODE_ENV", "production");
            logDir = Env("CHAT_DATA_DIR", Path.Combine(root, "data"));
            Directory.CreateDirectory(logDir);
            string id;
            using (var hash = SHA256.Create()) id = BitConverter.ToString(hash.ComputeHash(
                Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-", "");
            using (var stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\MetisStop-" + id)) {
                if (stop) { stopEvent.Set(); return; }
                bool created;
                using (var mutex = new Mutex(true, "Local\\MetisHost-" + id, out created)) {
                    if (!created) { if (open) OpenBrowser(); return; }
                    stopEvent.Reset();
                    var children = new List<Process>();
                    try {
                        if (Env("PORT", "3100") == Env("MCP_PORT", "8787"))
                            throw new Exception("PORT and MCP_PORT must be different.");
                        bool docker = Env("METIS_DOCKER", "0") == "1";
                        if (!docker) { CheckPort("PORT", "3100"); CheckPort("MCP_PORT", "8787"); }
                        string node = Env("METIS_NODE_BIN", "node.exe");
                        string tsx = "--import tsx ";
                        string[] commands = {
                            tsx + "\"" + Path.Combine(root, "server.mjs") + "\"",
                            tsx + "\"" + Path.Combine(root, "worker.ts") + "\"",
                            "\"" + Path.Combine(root, "lib/mcp-core/gateway-core.mjs") + "\""
                        };
                        string[] names = { "app", "worker", "mcp" };
                        if (docker) {
                            using (var compose = Start("docker.exe", "compose --env-file .env up -d --remove-orphans", "host")) {
                                compose.WaitForExit();
                                if (compose.ExitCode != 0) throw new Exception("Docker Compose failed. Check host.log.");
                            }
                        } else {
                            for (int i = 0; i < commands.Length; i++) children.Add(Start(node, commands[i], names[i]));
                        }
                        if (open) new Thread(OpenBrowser) { IsBackground = true }.Start();
                        while (!stopEvent.WaitOne(2000)) {
                            for (int i = 0; i < children.Count; i++) {
                                if (!children[i].HasExited) continue;
                                Log("host", names[i] + " exited; restarting.");
                                children[i].Dispose(); children[i] = Start(node, commands[i], names[i]);
                            }
                        }
                    } finally {
                        foreach (var child in children) {
                            try { if (!child.HasExited) child.Kill(); child.WaitForExit(); } catch (InvalidOperationException) {}
                            child.Dispose();
                        }
                        mutex.ReleaseMutex();
                    }
                }
            }
        } catch (Exception e) {
            if (logDir != null) Log("host", e.ToString());
            if (open) MessageBox.Show(e.Message, "Metis AI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }
}
'@ | Set-Content -LiteralPath $hostSource -Encoding UTF8
& $csc /nologo /target:winexe /reference:System.Windows.Forms.dll "/out:$hostNew" $hostSource
if ($LASTEXITCODE -ne 0) { throw "Metis host compilation failed; the existing host was not stopped." }
if (Test-Path -LiteralPath $hostExe) {
  Start-Process -FilePath $hostExe -ArgumentList "--stop" -Wait
  $running = @(Get-Process MetisHost -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $hostExe })
  foreach ($proc in $running) { if (-not $proc.WaitForExit(15000)) { throw "Existing Metis host did not stop. Check host.log." } }
}
# Migrate only legacy runners/processes belonging to this installation.
$rootNorm = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
$legacy = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($rootNorm, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $_.CommandLine -match 'run-service\.ps1|server\.mjs|worker\.ts|gateway-core\.mjs'
})
foreach ($proc in $legacy) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.ProcessId)" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "node.exe" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
Move-Item -LiteralPath $hostNew -Destination $hostExe -Force
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-Item -Path $runKey -Force | Out-Null
foreach ($suffix in @("app", "worker", "mcp")) {
  Remove-ItemProperty -LiteralPath $runKey -Name "$serviceName-$suffix" -ErrorAction SilentlyContinue
}
Set-ItemProperty -LiteralPath $runKey -Name "$serviceName-host" -Value "`"$hostExe`""
$menuDir = Join-Path ([Environment]::GetFolderPath("Programs")) $serviceName
New-Item -ItemType Directory -Force -Path $menuDir | Out-Null
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $menuDir "Metis AI.lnk"))
$link.TargetPath = $hostExe
$link.Arguments = "--open"
$link.WorkingDirectory = $InstallDir
$link.Description = "Start Metis AI in the background and open it in your browser"
$link.Save()
New-Item -Path $appKey -Force | Out-Null
Set-ItemProperty -Path $appKey -Name DisplayName -Value "Metis AI"
Set-ItemProperty -Path $appKey -Name Publisher -Value "Metis AI"
Set-ItemProperty -Path $appKey -Name InstallLocation -Value $InstallDir
Set-ItemProperty -Path $appKey -Name DisplayIcon -Value $hostExe
$uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`" -InstallDir `"$InstallDir`""
Set-ItemProperty -Path $appKey -Name UninstallString -Value $uninstallCommand
Remove-Item Env:METIS_AI_BOOTSTRAP_USERNAME,Env:METIS_AI_BOOTSTRAP_PASSWORD,Env:METIS_AI_BOOTSTRAP_OPTIONAL -ErrorAction SilentlyContinue
$manifest = @{
  installDir = $InstallDir
  dataDir = $dataDir
  agentCwd = $agentCwd
  serviceName = $serviceName
  host = $aiChatHost
  os = "windows"
  installMethod = $(if ($useDocker) { "docker" } else { "native" })
  createdAt = [DateTime]::UtcNow.ToString("o")
} | ConvertTo-Json -Compress
Set-Content -LiteralPath (Join-Path $InstallDir ".metis-ai-install.json") -Value $manifest -Encoding utf8
Copy-Item -LiteralPath (Join-Path $InstallDir "install/uninstall.ps1") -Destination (Join-Path $InstallDir "uninstall.ps1") -Force
Start-Process -FilePath $hostExe

for ($attempt = 0; $attempt -lt 45; $attempt++) {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 2
    if ($null -eq $status.authenticated -or -not $status.worker -or -not $status.mcp) { throw "The response is not a Metis status response." }
    break
  } catch {
    if ($attempt -eq 44) { throw "Metis did not become healthy on web port $port. Check $dataDir/app.log and $dataDir/host.log for startup errors or a port conflict." }
    Start-Sleep -Seconds 1
  }
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$mcpPort/health" -TimeoutSec 2
    if (-not $health.ok -or $health.name -notlike '*Universal MCP Gateway' -or $health.endpoint -ne '/mcp') { throw "The response is not a Metis MCP gateway." }
    break
  } catch {
    if ($attempt -eq 19) { throw "Metis MCP gateway did not become healthy on port $mcpPort. Check $dataDir/mcp.log and $dataDir/host.log; another application may have taken this port." }
    Start-Sleep -Seconds 1
  }
}


if ($aiChatHost -eq "0.0.0.0") {
  Write-Host "Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy."
}
Write-Host "`nMetis AI installed successfully."
Write-Host "Open: $publicUrl (or Metis AI in the Start menu)"
Write-Host "Host: background app, starts automatically at sign-in. Logs: $dataDir"
Write-Host "You can change this. Add: $(Join-Path $InstallDir '.env')"
if ($useDocker) {
  Write-Host "Apply: $(Join-Path $InstallDir 'reload.ps1')"
}
Write-Host "Uninstall: $(Join-Path $InstallDir 'uninstall.ps1') -InstallDir `"$InstallDir`" -KeepData"
