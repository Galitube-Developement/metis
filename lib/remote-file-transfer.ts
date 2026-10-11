import { randomBytes } from "node:crypto";
import { config } from "@/lib/config";
import { getCompletedUpload, uploadedFileResponse } from "@/lib/file-upload-store";
import { authorizeRemoteAction, getRemoteClient } from "@/lib/remote-clients";
import { requestRemoteClient } from "@/lib/remote-client-gateway";
import { sanitizeFileName } from "@/lib/uploads";

type Ticket = { ownerId: string; uploadId: string; expiresAt: number };
const globalState = globalThis as typeof globalThis & { __metisFileTransfers?: Map<string, Ticket> };
const tickets = globalState.__metisFileTransfers ||= new Map<string, Ticket>();
function pruneTickets() { for (const [id, ticket] of tickets) if (ticket.expiresAt <= Date.now()) tickets.delete(id); }

export function remoteTransferDownload(token: string, req: Request) {
  pruneTickets();
  const ticket = tickets.get(token);
  if (!ticket) return Response.json({ error: "Transfer expired" }, { status: 404 });
  try {
    const response = uploadedFileResponse(ticket.ownerId, ticket.uploadId, req);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch { return Response.json({ error: "File not found" }, { status: 404 }); }
}

/** Generated commands contain only fixed code and base64 data, never shell-interpolated names. */
export function desktopTransferCommand(url: string, filename: string, size: number, os?: string) {
  let safeName = sanitizeFileName(filename).replace(/[. ]+$/, "") || "file";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)) safeName = "_" + safeName;
  const payload = Buffer.from(JSON.stringify({ url, filename: safeName, size })).toString("base64");
  if (os && /windows|win32/i.test(os)) {
    const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$desktop=[Environment]::GetFolderPath('Desktop')
if(-not $desktop){throw 'Desktop folder unavailable'}
[IO.Directory]::CreateDirectory($desktop) | Out-Null
$temporary=[IO.Path]::Combine($desktop,'.metis-upload-'+[Guid]::NewGuid().ToString()+'.part')
try {
  $request=[Net.HttpWebRequest]::Create($data.url)
  $request.Timeout=270000; $request.ReadWriteTimeout=270000
  $response=$request.GetResponse()
  try {
    $inputStream=$response.GetResponseStream()
    $outputStream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew)
    try {$inputStream.CopyTo($outputStream)} finally {$outputStream.Dispose();$inputStream.Dispose()}
  } finally {$response.Dispose()}
  if((Get-Item -LiteralPath $temporary).Length -ne $data.size){throw 'Incomplete file transfer'}
  $name=[IO.Path]::GetFileNameWithoutExtension($data.filename); $extension=[IO.Path]::GetExtension($data.filename)
  for($i=0;$i -lt 10000;$i++){
    $filename=if($i -eq 0){$data.filename}else{$name+' ('+$i+')'+$extension}
    $destination=[IO.Path]::Combine($desktop,$filename)
    try {
      [IO.File]::Copy($temporary,$destination,$false)
      @{path=$destination;bytes=$data.size} | ConvertTo-Json -Compress
      exit 0
    } catch [IO.IOException] {if(-not [IO.File]::Exists($destination)){throw}}
  }
  throw 'Could not choose a free filename'
} finally {if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
`;
    return "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
  }
  const script = `
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {pipeline}=require('stream/promises'),{Readable}=require('stream');
const data=JSON.parse(Buffer.from('${payload}','base64').toString());
(async()=>{
 let desktop;
 if(process.platform==='win32'){
  desktop=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetFolderPath('Desktop')"],{encoding:'utf8',windowsHide:true}).trim();
 }else if(process.platform==='linux'){
  try{desktop=cp.execFileSync('xdg-user-dir',['DESKTOP'],{encoding:'utf8'}).trim();}catch{}
 }
 desktop=desktop||path.join(os.homedir(),'Desktop');
 fs.mkdirSync(desktop,{recursive:true});
 const temporary=path.join(desktop,'.metis-upload-'+require('crypto').randomUUID()+'.part');
 try{
  const response=await fetch(data.url,{signal:AbortSignal.timeout(270000)});
  if(!response.ok||!response.body)throw Error('File transfer failed: HTTP '+response.status);
  await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(temporary,{flags:'wx'}));
  if(fs.statSync(temporary).size!==data.size)throw Error('Incomplete file transfer');
  const parsed=path.parse(data.filename);
  for(let i=0;i<10000;i++){
   const destination=path.join(desktop,i?parsed.name+' ('+i+')'+parsed.ext:data.filename);
   try{fs.copyFileSync(temporary,destination,fs.constants.COPYFILE_EXCL);console.log(JSON.stringify({path:destination,bytes:data.size}));return;}
   catch(error){if(error.code!=='EEXIST')throw error;}
  }
  throw Error('Could not choose a free filename');
 }finally{fs.rmSync(temporary,{force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1});
`;
  return 'node -e "eval(Buffer.from(\'' + Buffer.from(script).toString("base64") + '\',\'base64\').toString())"';
}

export async function transferFileToDesktop(ownerId: string, clientId: string, uploadId: string) {
  const client = getRemoteClient(clientId, ownerId);
  if (!client) throw new Error("Remote client not found");
  if (client.status !== "online") throw new Error("Remote client is offline");
  const upload = getCompletedUpload(ownerId, uploadId);
  const write = authorizeRemoteAction(client, "write_file", { path: "Desktop/" + sanitizeFileName(upload.name) });
  if (!write.allowed) throw new Error(write.reason || "Writing files is disabled for this device");
  // The existing client transports binary files through a streamed download command.
  // Keep command restrictions and approvals enforced by the gateway; never bypass policy.
  if (client.policy.mode !== "full_access") throw new Error("Desktop file transfer requires Full access for this Remote Device.");
  pruneTickets();
  if (tickets.size >= 1000) throw new Error("Too many active file transfers");
  const token = randomBytes(32).toString("hex");
  tickets.set(token, { ownerId, uploadId, expiresAt: Date.now() + 5 * 60_000 });
  try {
    const url = new URL("/api/remote-file-transfers/" + token, config.publicUrl).href;
    const result = await requestRemoteClient({ ownerId, clientId, action: "execute_command", source: "user",
      timeoutMs: 300_000, params: { command: desktopTransferCommand(url, upload.name, upload.size, client.os), timeout: 300_000 } }) as { stdout?: string };
    const saved = JSON.parse(result.stdout?.trim() || "{}") as { path?: string; bytes?: number };
    if (!saved.path || saved.bytes !== upload.size) throw new Error("The Remote Client did not confirm the file transfer.");
    return saved;
  } finally { tickets.delete(token); }
}
