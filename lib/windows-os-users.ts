import type { HostOsUser } from "@/lib/user-isolation";

// powershell.exe is Windows PowerShell 5.1. Keep this script compatible with it.
// Resolve profile directories through SID, never guess C:\\Users\\<account-name>.
export const windowsOsUserListScript = [
  "$ErrorActionPreference = 'Stop'",
  "$profiles = @{}",
  "Get-CimInstance Win32_UserProfile | ForEach-Object { if ($_.LocalPath) { $profiles[[string]$_.SID] = $_.LocalPath } }",
  "try { $accounts = @(Get-LocalUser -ErrorAction Stop | Where-Object { $_.Enabled } | ForEach-Object { [pscustomobject]@{ Name = $_.Name; SID = $_.SID.Value } }) }",
  "catch { $accounts = @(Get-CimInstance Win32_UserAccount -Filter \"LocalAccount=True AND Disabled=False\" | Select-Object Name,SID) }",
  "$accounts | ForEach-Object { $profileHome = $profiles[[string]$_.SID]; if (-not $profileHome) { $profileHome = '' }; Write-Output ($_.Name + [char]9 + $profileHome) }",
].join("\n");

export function hostUserFromInfo(
  info: { username: string; uid: number; gid: number; homedir: string },
  platform: NodeJS.Platform,
): HostOsUser {
  return {
    username: info.username,
    home: info.homedir,
    ...(platform === "win32" ? {} : { uid: info.uid, gid: info.gid }),
  };
}
