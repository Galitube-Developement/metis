import { execFileSync } from "node:child_process";

// POSIX modes do not protect Windows files; check the native DACL.
export function windowsSetupTokenAclScript(file: string, protect: boolean) {
  const literal = "'" + file.replace(/'/g, "''") + "'";
  return [
    "$ErrorActionPreference = 'Stop'",
    "$file = " + literal,
    "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')",
    "$item = Get-Item -LiteralPath $file -Force",
    "if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Setup token cannot be a reparse point.' }",
    "$acl = Get-Acl -LiteralPath $file",
    "$owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value",
    "if ($trusted -notcontains $owner) { throw 'Setup token must be operator-owned.' }",
    ...(protect ? [
      "$acl.SetAccessRuleProtection($true, $false)",
      "foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }",
      "foreach ($identity in $trusted) {",
      "  $principal = New-Object Security.Principal.SecurityIdentifier($identity)",
      "  $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)",
      "  $acl.AddAccessRule($rule)",
      "}",
      "Set-Acl -LiteralPath $file -AclObject $acl",
      "$acl = Get-Acl -LiteralPath $file",
    ] : []),
    "if (-not $acl.AreAccessRulesProtected) { throw 'Setup token must have inheritance disabled.' }",
    "foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {",
    "  if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $trusted -notcontains $rule.IdentityReference.Value) { throw 'Setup token grants access to another identity.' }",
    "}",
    "Write-Output 'SETUP_TOKEN_ACL_PRIVATE'",
  ].join("\n");
}
export function secureWindowsSetupToken(file: string, protect = false) {
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(windowsSetupTokenAclScript(file, protect), "utf16le").toString("base64")], {
    encoding: "utf8", timeout: 15_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  if (output.trim() !== "SETUP_TOKEN_ACL_PRIVATE") throw new Error("Could not verify private setup token ACL.");
}
