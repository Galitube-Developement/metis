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

