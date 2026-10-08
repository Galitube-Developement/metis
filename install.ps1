# Metis AI Windows bootstrap. No param(): also supports Invoke-Expression.
$ErrorActionPreference = "Stop"
$base = if ($env:METIS_AI_INSTALL_BASE) { $env:METIS_AI_INSTALL_BASE.TrimEnd("/") } else { "" }
$requestedTag = "latest"
$requestedCommit = ""
$versionSet = $false
$forward = @()
$rawArgs = @($args)
if (-not $rawArgs.Count -and $MyInvocation.UnboundArguments) { $rawArgs = @($MyInvocation.UnboundArguments) }
$isUninstall = $rawArgs.Count -gt 0 -and ([string]$rawArgs[0]).ToLowerInvariant() -eq "uninstall"
for ($i = 0; $i -lt $rawArgs.Count; $i++) {
  $arg = [string]$rawArgs[$i]
  switch -Regex ($arg) {
    "^(--version|-Version)$" {
      if ($i + 1 -ge $rawArgs.Count) { throw "$arg requires a value." }
      $i++; $requestedTag = [string]$rawArgs[$i]; $versionSet = $true
    }
    "^(--commit|-Commit)$" {
      if ($i + 1 -ge $rawArgs.Count) { throw "$arg requires a value." }
      $i++; $requestedCommit = [string]$rawArgs[$i]
    }
    default { $forward += $arg }
  }
}
if ($requestedCommit -and $versionSet) { throw "Use -Commit or -Version, not both." }
$releaseAssets = ""
if ($requestedCommit) {
  if ($requestedCommit -notmatch "^[0-9a-fA-F]{7,40}$") { throw "Commit must be a git SHA." }
  if (-not $base) { $base = "https://raw.githubusercontent.com/f1shyondrugs/metis-ai/$requestedCommit" }
  if (-not $isUninstall) { $forward += @("-Commit", $requestedCommit) }
} else {
  if (-not $base) {
    if ($requestedTag -eq "latest") {
      try {
        $release = Invoke-RestMethod -Headers @{ Accept = "application/vnd.github+json" } -Uri "https://api.github.com/repos/f1shyondrugs/metis-ai/releases/latest"
        $requestedTag = [string]$release.tag_name
      } catch { throw "Could not resolve the latest stable Metis AI release." }
    }
    if ($requestedTag -notmatch "^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$") { throw "The selected release tag is invalid: $requestedTag" }
    $base = "https://raw.githubusercontent.com/f1shyondrugs/metis-ai/$requestedTag"
    if (-not $isUninstall) { $releaseAssets = "https://github.com/f1shyondrugs/metis-ai/releases/download/$requestedTag" }
  }
  if (-not $isUninstall) { $forward += @("-Version", $requestedTag) }
}
if ($isUninstall) {
  $mapped = @()
  for ($i = 0; $i -lt $forward.Count; $i++) {
    $arg = [string]$forward[$i]
    switch -Regex ($arg) {
      "^--yes$" { $mapped += "-Yes" }
      "^--keep-data$" { $mapped += "-KeepData" }
      "^--remove-data$" { $mapped += "-RemoveData" }
      "^--dry-run$" { $mapped += "-DryRun" }
      "^--install-dir$" { $mapped += "-InstallDir"; $i++; $mapped += $forward[$i] }
      "^--service-name$" { $mapped += "-ServiceName"; $i++; $mapped += $forward[$i] }
      default { $mapped += $arg }
    }
  }
  $forward = $mapped
}
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("metis-ai-windows-" + [guid]::NewGuid())
$dest = Join-Path $tempDir "windows.ps1"
try {
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $url = if ($releaseAssets) { "$releaseAssets/metis-windows.ps1" } else { "$base/install/windows.ps1" }
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest
  if ($releaseAssets) {
    $sumsFile = Join-Path $tempDir "SHA256SUMS"
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseAssets/SHA256SUMS" -OutFile $sumsFile
    $entries = @(Get-Content $sumsFile | Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+metis-windows\.ps1$' })
    if ($entries.Count -ne 1) { throw "Missing or ambiguous installer checksum." }
    $expected = ($entries[0] -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $expected) { throw "SHA256 verification failed." }
  }
  if ($isUninstall) { Invoke-WebRequest -UseBasicParsing -Uri "$base/install/uninstall.ps1" -OutFile (Join-Path $tempDir "uninstall.ps1") }
  $env:METIS_AI_INSTALL_BASE = $base
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest @forward
  if ($LASTEXITCODE -ne 0) { throw "Metis AI installer failed (exit $LASTEXITCODE). This PowerShell session remains open." }
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
# Never exit here: an irm | iex caller must retain its session.
