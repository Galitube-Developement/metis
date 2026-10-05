Option Explicit
Dim fso, shell, root, envPath, nodeBin, arg, args, i, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
envPath = fso.BuildPath(root, ".env")
nodeBin = ""
If fso.FileExists(envPath) Then
  Dim stream, content, lines, line, p, key, value
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Charset = "utf-8"
  stream.Open
  stream.LoadFromFile envPath
  content = stream.ReadText
  stream.Close
  lines = Split(Replace(content, vbCr, ""), vbLf)
  For Each line In lines
    line = Trim(line)
    If Left(line, 1) <> "#" Then
      p = InStr(line, "=")
      If p > 1 Then
        key = Trim(Left(line, p - 1))
        value = Trim(Mid(line, p + 1))
        If key = "METIS_NODE_BIN" Then
          If Len(value) >= 2 And Left(value, 1) = Chr(34) And Right(value, 1) = Chr(34) Then value = Mid(value, 2, Len(value) - 2)
          nodeBin = value
        End If
      End If
    End If
  Next
End If
If Len(nodeBin) = 0 Then
  nodeBin = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
  If Not fso.FileExists(nodeBin) Then nodeBin = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe")
  If Not fso.FileExists(nodeBin) Then nodeBin = "node.exe"
End If
args = ""
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If arg <> "--open" And arg <> "--stop" Then
    WScript.Echo "Usage: install\windows-launcher.vbs [--open|--stop]"
    WScript.Quit 2
  End If
  args = args & " " & Quote(arg)
Next
command = Quote(nodeBin) & " " & Quote(fso.BuildPath(root, "windows-script-host.mjs")) & args
shell.CurrentDirectory = root
shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
