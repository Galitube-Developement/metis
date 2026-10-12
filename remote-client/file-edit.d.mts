import type fs from "node:fs";
export type FileReplacement = { oldText:string; newText:string; replaceAll?:boolean; expectedOccurrences?:number };
export type FileEditInput = { path:string; oldText?:string; newText?:string; edits?:FileReplacement[]; replaceAll?:boolean; expectedOccurrences?:number; dryRun?:boolean };
export function normalizeFileEdit(input?:unknown): {path:string;edits:FileReplacement[];dryRun:boolean};
export function applyFileEdits(content:string, edits:FileReplacement[]): {content:string;edits:Array<{index:number;replacements:number;firstLine:number}>;replacements:number};
export function executeFileEdit(io:typeof fs, input:unknown): {path:string;replacements:number;bytes:number;changed:boolean;wouldChange:boolean;dryRun:boolean;edits:Array<{index:number;replacements:number;firstLine:number}>};
export function buildFileEditProgram(input:unknown):string;
export const FILE_EDIT_PROPERTIES:Record<string,unknown>;
export const FILE_EDIT_DESCRIPTION:string;
