param(
  [string]$InstallDir = "",
  [string]$ServiceName = "MetisAI",
  [switch]$KeepData,
  [switch]$RemoveData,
  [switch]$DryRun,
  [switch]$Yes
)
$ErrorActionPreference = "Stop"
if (-not $InstallDir) {
  try {
    $InstallDir = (Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$ServiceName" -ErrorAction Stop).InstallLocation
  } catch {}
}
if (-not $InstallDir) {
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  foreach ($candidate in @($ServiceName, "MetisAI", "metis-ai")) {
    try {
      $existingRun = (Get-ItemProperty -LiteralPath $runKey -Name "$candidate-app" -ErrorAction Stop)."$candidate-app"
      if ($existingRun) {
        $cmdPath = [string]$existingRun.Trim().Trim('"')
        if (Test-Path -LiteralPath $cmdPath) {
          $InstallDir = Split-Path -Parent $cmdPath
          $ServiceName = $candidate
          break
        }
      }
    } catch {}
  }
}
if (-not $InstallDir) { throw "Metis AI is not installed (no startup entry for $ServiceName). Nothing to uninstall. Pass -InstallDir DIR if files are leftover." }
$manifestPath = Join-Path $InstallDir ".metis-ai-install.json"
$manifest = $null
if (Test-Path $manifestPath) {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
} else {
  $manifest = [pscustomobject]@{ serviceName = $ServiceName; dataDir = ""; installMethod = "native" }
}
if ([IO.Path]::GetFullPath($InstallDir).TrimEnd("\") -eq [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($InstallDir)).TrimEnd("\")) {
  throw "Refusing to remove a filesystem root."
}
if (-not $Yes) {
  $answer = Read-Host "Remove Metis AI installation at $InstallDir? Type 'yes'"
  if ($answer -cne "yes") { Write-Host "Aborted."; exit 0 }
}
function Invoke-Step([scriptblock]$Action, [string]$Description) {
  if ($DryRun) { Write-Host "+ $Description" } else { & $Action }
}
function Test-InstallProcess($Process, [string[]]$Roots) {
  if ($Process.Name -notin @("node.exe", "esbuild.exe")) { return $false }
  foreach ($root in $Roots) {
    if (-not $root) { continue }
    $prefix = $root.TrimEnd('\') + '\'
    if ($Process.Name -eq "node.exe" -and $Process.CommandLine -and
        $Process.CommandLine.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($Process.Name -eq "esbuild.exe" -and $Process.ExecutablePath -and
        $Process.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$rootNorm = [IO.Path]::GetFullPath($InstallDir).TrimEnd("\")
$hostExe = Join-Path $InstallDir "MetisHost.exe"
$scriptHost = Join-Path $InstallDir "windows-script-host.mjs"
if (Test-Path -LiteralPath $scriptHost) {
  Invoke-Step {
    $node = (Get-Command node -ErrorAction Stop).Source
    & $node $scriptHost --stop
    if ($LASTEXITCODE -ne 0) { throw "Metis script host did not stop. Check host.log." }
  } "Stop Metis script background host"
}
$hostProcesses = @(Get-CimInstance Win32_Process -Filter "Name='MetisHost.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($hostExe) })
if ($hostProcesses.Count) {
  Invoke-Step {
    Start-Process -FilePath $hostExe -ArgumentList "--stop" -Wait
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      $running = @(Get-CimInstance Win32_Process -Filter "Name='MetisHost.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($hostExe) })
      if (-not $running.Count) { break }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    foreach ($proc in $running) {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if (@(Get-CimInstance Win32_Process -Filter "Name='MetisHost.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($hostExe) }).Count) {
      throw "Metis host did not stop. Check host.log."
    }
  } "Stop Metis background host"
}
Invoke-Step { Remove-ItemProperty -LiteralPath $runKey -Name "$($manifest.serviceName)-host" -ErrorAction SilentlyContinue } "Remove host startup entry"
Invoke-Step { Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath("Programs")) $manifest.serviceName) -Recurse -Force -ErrorAction SilentlyContinue } "Remove Metis Start menu entry"
Invoke-Step { Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($manifest.serviceName)" -Recurse -Force -ErrorAction SilentlyContinue } "Remove Metis application registration"
if ($manifest.installMethod -eq "docker") {
  Invoke-Step { Push-Location $InstallDir; docker compose down; Pop-Location } "docker compose down"
} else {
foreach ($suffix in @("app", "worker", "mcp")) {
  $task = "$($manifest.serviceName)-$suffix"
  Invoke-Step { Remove-ItemProperty -LiteralPath $runKey -Name $task -ErrorAction SilentlyContinue } "Remove startup entry $task"
  Invoke-Step { cmd.exe /c "schtasks /Delete /TN `"$task`" /F >nul 2>&1" } "Delete scheduled task $task"
}
$rootAliases = @($InstallDir, $rootNorm)
if ($manifest.installDir -and [IO.Path]::GetFullPath([string]$manifest.installDir).TrimEnd('\') -eq $rootNorm) {
  $rootAliases += [string]$manifest.installDir
}
Invoke-Step {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { Test-InstallProcess $_ $rootAliases } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} "Stop running Metis node processes"
}
function Remove-Tree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $target = $Path
  if ($target -notlike "\\?\*") { $target = "\\?\$Path" }
  for ($i = 0; $i -lt 8; $i++) {
    cmd.exe /c "rmdir /s /q `"$target`"" | Out-Null
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Start-Sleep -Seconds 2
  }
  throw "Failed to remove $Path"
}
$shouldKeepData = $KeepData -and -not $RemoveData
$keepStash = $null
$keepEnvStash = $null
if ($shouldKeepData) {
  $envFile = Join-Path $InstallDir ".env"
  if (Test-Path -LiteralPath $envFile) {
    $keepEnvStash = Join-Path (Split-Path -Parent $rootNorm) (".$(Split-Path -Leaf $rootNorm).metis-keep-env")
    Invoke-Step {
      Copy-Item -LiteralPath $envFile -Destination $keepEnvStash -Force
    } "Stash .env to $keepEnvStash"
  }
  $dataDir = [string]$manifest.dataDir
  if (-not $dataDir) {
    $envFile = Join-Path $InstallDir ".env"
    if (Test-Path -LiteralPath $envFile) {
      $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^CHAT_DATA_DIR=' } | Select-Object -First 1
      if ($line) { $dataDir = $line.Substring('CHAT_DATA_DIR='.Length).Trim().Trim('"') }
    }
  }
  if (-not $dataDir -and (Test-Path -LiteralPath (Join-Path $InstallDir "data"))) {
    $dataDir = Join-Path $InstallDir "data"
  }
  if ($dataDir -and (Test-Path -LiteralPath $dataDir)) {
    $dataFull = [IO.Path]::GetFullPath($dataDir).TrimEnd('\')
    if ($dataFull -ne $rootNorm -and $dataFull.StartsWith($rootNorm + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      $keepStash = "$rootNorm.metis-keep-data"
      Invoke-Step {
        if (Test-Path -LiteralPath $keepStash) { Remove-Item -LiteralPath $keepStash -Recurse -Force }
        Move-Item -LiteralPath $dataDir -Destination $keepStash
      } "Stash nested data to $keepStash"
    }
  }
}
if (-not $shouldKeepData -and $manifest.dataDir -and ([IO.Path]::GetFullPath($manifest.dataDir) -ne [IO.Path]::GetFullPath($InstallDir))) {
  Invoke-Step { Remove-Tree ([IO.Path]::GetFullPath($manifest.dataDir)) } "Remove data directory"
}
Invoke-Step { Start-Sleep -Seconds 1; Remove-Tree $rootNorm } "Remove installation directory"
if ($keepStash -or $keepEnvStash) {
  Write-Host "Metis AI uninstalled. Data kept: $(if ($keepStash) { $keepStash } else { $shouldKeepData }); env kept: $(if ($keepEnvStash) { $keepEnvStash } else { 'none' })"
} else {
  Write-Host "Metis AI uninstalled. Data kept: $shouldKeepData"
}
