"use client";
import type { SharedNote } from "@/lib/store";
import { FileEmbed } from "@/components/file-embed";
import { parseFileEmbed, type FileEmbedSpec } from "@/lib/file-types";
export function NoteMedia({ note, onChange, onRemove }: {note:SharedNote;onChange?:(content:string)=>void;onRemove?:()=>void}) {
  if(!note.asset)return null;
  const file:FileEmbedSpec = {...parseFileEmbed(note.content),...note.asset,url:"/api/file-uploads/"+encodeURIComponent(note.asset.id)+"/file"};
  return <FileEmbed resizable={false} file={file} className="min-h-0 flex-1" onChange={onChange ? next=>onChange(JSON.stringify(next)):undefined} onRemove={onRemove}/>;
}
