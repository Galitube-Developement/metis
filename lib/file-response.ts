import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { effectiveFileMime, fileViewKind } from "@/lib/file-types";

/** One bounded streaming response for every attachment surface, including seeking in media. */
export function fileResponse(file: string, asset: {name:string;mimeType:string}, req?: Request) {
  const size = statSync(file).size;
  const mime = effectiveFileMime(asset.mimeType,asset.name);
  const kind = fileViewKind(mime,asset.name);
  const inline = ["image","video","audio","pdf"].includes(kind) && mime !== "image/svg+xml";
  const headers = new Headers({
    "Content-Type": inline ? mime : kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream",
    "Content-Disposition": (inline && !new URL(req?.url || "http://localhost").searchParams.has("download") ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(asset.name),
    "Content-Length": String(size), "Accept-Ranges":"bytes", "Cache-Control":"private, max-age=0, must-revalidate",
    "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"sandbox"
  });
  const range = req?.headers.get("range");
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]) || size === 0) {
      headers.set("Content-Range", "bytes */" + size); headers.set("Content-Length","0");
      return new Response(null,{status:416,headers});
    }
    start = match[1] ? Number(match[1]) : Math.max(0,size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(size-1,Number(match[2])) : size-1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!match[1] && Number(match[2]) === 0)) {
      headers.set("Content-Range", "bytes */" + size); headers.set("Content-Length","0");
      return new Response(null,{status:416,headers});
    }
    status = 206; headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
    headers.set("Content-Length",String(end-start+1));
  }
  if (size === 0 || req?.method === "HEAD") return new Response(null,{status,headers});
  return new Response(Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status,headers});
}
