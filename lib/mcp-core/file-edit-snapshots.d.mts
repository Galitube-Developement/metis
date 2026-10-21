export type FileSnapshotScope = { userId?: string; chatId?: string; jobId?: string; incognito?: boolean };
export function storeFileEditSnapshot(result: Record<string, unknown>, scope: FileSnapshotScope, target?: string): Record<string, unknown>;
export function readFileEditSnapshot(id: unknown, scope?: FileSnapshotScope): {path:string;target:string;diff:{before?:string;after:string}} | undefined;
export function acknowledgeFileEditSnapshot(id: unknown, chatId: string, snapshot: {path?:string;before?:string;after?:string}): void;
