import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// A passive primary-display capture: no foreground-window, pointer or input changes.
export const windowsDesktopPreviewScript = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MetisPreview {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f,bool i,uint a);
 [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h,int n,StringBuilder s,int l,out int r);
 public static bool Unlocked() {
  IntPtr h=OpenInputDesktop(0,false,1); if(h==IntPtr.Zero)return false;
  try { var s=new StringBuilder(256); int n; return GetUserObjectInformation(h,2,s,512,out n)&&s.ToString()=="Default"; }
  finally { CloseDesktop(h); }
 }
}
'@
[MetisPreview]::SetProcessDPIAware() | Out-Null
if(-not [MetisPreview]::Unlocked()){throw 'The Windows desktop is locked or unavailable'}
$r=[Windows.Forms.Screen]::PrimaryScreen.Bounds
if($r.Width -lt 1 -or $r.Height -lt 1){throw 'No interactive display is available'}
$b=[Drawing.Bitmap]::new($r.Width,$r.Height)
try {
 $g=[Drawing.Graphics]::FromImage($b)
 try {$g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size)} finally {$g.Dispose()}
 $w=[Math]::Min(1600,$r.Width); $h=[Math]::Max(1,[int]($r.Height*$w/$r.Width))
 $small=[Drawing.Bitmap]::new($w,$h)
 try {
  $g=[Drawing.Graphics]::FromImage($small)
  try {$g.DrawImage($b,0,0,$w,$h)} finally {$g.Dispose()}
  $s=[IO.MemoryStream]::new()
  try {
   $small.Save($s,[Drawing.Imaging.ImageFormat]::Jpeg)
   @{image_base64=[Convert]::ToBase64String($s.ToArray());mimeType='image/jpeg';width=$w;height=$h} | ConvertTo-Json -Compress
  } finally {$s.Dispose()}
 } finally {$small.Dispose()}
} finally {$b.Dispose()}
`;

export function windowsDesktopPreviewCommand() {
  return "powershell.exe -NoProfile -NonInteractive -EncodedCommand " +
    Buffer.from(windowsDesktopPreviewScript, "utf16le").toString("base64");
}

export async function captureDesktopPreview({ signal, platform = process.platform, run = exec, env = process.env } = {}) {
  const options = { signal, env, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 };
  if (platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(windowsDesktopPreviewScript, "utf16le").toString("base64")], options);
    return JSON.parse(String(result.stdout).trim());
  }
  if (platform === "darwin") {
    // The existing helper checks Screen Recording and the session lock without raising a window.
    const { unixComputerUse } = await import("./computer-use-unix.mjs");
    const state = await unixComputerUse({ operation: "status" }, { signal, platform, env, run });
    if (!state.available) throw new Error(state.reason || "Desktop capture is unavailable");
    const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "metis-preview-"));
    try {
      const file = path.join(dir, "screen.jpg");
      await run("/usr/sbin/screencapture", ["-x", "-m", "-t", "jpg", file], options);
      return { image_base64: (await fs.readFile(file)).toString("base64"), mimeType: "image/jpeg" };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  if (platform === "linux") {
    const { unixComputerUse } = await import("./computer-use-unix.mjs");
    const state = await unixComputerUse({ operation: "status" }, { signal, platform, env, run });
    if (!state.available) throw new Error(state.reason || "Desktop capture is unavailable");
    const result = await run("import", ["-window", "root", "-resize", "1600x1600>", "jpeg:-"],
      { ...options, encoding: "buffer" });
    return { image_base64: Buffer.from(result.stdout).toString("base64"), mimeType: "image/jpeg" };
  }
  throw new Error("Desktop preview is unavailable on this operating system");
}
