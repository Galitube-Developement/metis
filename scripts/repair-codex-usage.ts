/**
 * Repair only provable cumulative Codex usage for one account.
 * Dry run: pnpm exec tsx scripts/repair-codex-usage.ts --owner <id>
 * Apply: add --apply --backup <private-json-path>
 */
import { createReadStream, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "../lib/config";
import { codexCompletedUsage, type CodexCompletedUsage } from "../lib/providers/codex-usage";

type UsageRow = { owner_id: string; message_id: string; completed_at: string; input_tokens: number|null; output_tokens: number|null; total_tokens: number|null; cached_input_tokens: number|null; cache_write_input_tokens: number|null };
type Repair = { before: UsageRow; turn: CodexCompletedUsage };
const key = (input: number|null, output: number|null) => input + ":" + output;

export async function repairCodexUsage(options: {
  db: DatabaseSync; ownerId: string; dataDir: string; apply?: boolean; backupPath?: string;
}) {
  const { db, ownerId } = options;
  if (!/^[a-zA-Z0-9_-]+$/.test(ownerId)) throw new Error("Invalid owner ID");
  if (options.apply && !options.backupPath) throw new Error("Applying repairs requires a private backup path");
  const rows = db.prepare("SELECT owner_id,message_id,completed_at,input_tokens,output_tokens,total_tokens,cached_input_tokens,cache_write_input_tokens FROM account_usage WHERE owner_id=? AND provider_id='codex'").all(ownerId) as UsageRow[];
  const wanted = new Set(rows.map(row => key(row.input_tokens, row.output_tokens)));
  const matches = new Map<string, CodexCompletedUsage[]>();
  const root = path.join(options.dataDir, "provider-sessions", "codex", ownerId);
  let files = 0;
  if (existsSync(root)) {
    for (const connection of readdirSync(root, { withFileTypes: true })) {
      if (!connection.isDirectory() || connection.isSymbolicLink()) continue;
      const sessions = path.join(root, connection.name, "sessions");
      if (!existsSync(sessions)) continue;
      for (const entry of readdirSync(sessions, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/^rollout-.*-[a-f0-9-]{36}\.jsonl$/i.test(entry.name)) continue;
        files++;
        const stream = createReadStream(path.join(entry.parentPath, entry.name), { encoding: "utf8" });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
          for (const turn of await codexCompletedUsage(lines)) {
            const id = key(turn.cumulative.inputTokens, turn.cumulative.outputTokens);
            if (!wanted.has(id)) continue;
            const list = matches.get(id) || [];
            list.push(turn); matches.set(id, list);
          }
        } finally { lines.close(); stream.destroy(); }
      }
    }
  }
  const repairs: Repair[] = [];
  let proven = 0, unmatched = 0;
  for (const row of rows) {
    const candidates = (matches.get(key(row.input_tokens,row.output_tokens)) || []).filter(turn => {
      const lag = Date.parse(row.completed_at) - Date.parse(turn.completedAt);
      return lag >= 0 && lag <= 60_000
        && (row.cached_input_tokens === null || row.cached_input_tokens === (turn.cumulative.cachedInputTokens ?? null))
        && (row.cache_write_input_tokens === null || row.cache_write_input_tokens === (turn.cumulative.cacheWriteInputTokens ?? null));
    });
    if (candidates.length !== 1) { unmatched++; continue; }
    proven++;
    const turn = candidates[0];
    if (row.total_tokens !== turn.usage.inputTokens + turn.usage.outputTokens
      || row.input_tokens !== turn.usage.inputTokens || row.output_tokens !== turn.usage.outputTokens) repairs.push({ before: row, turn });
  }
  const days: Record<string,{before:number;after:number;correctedRuns:number}> = {};
  for (const row of rows) {
    const day = days[row.completed_at.slice(0,10)] ||= {before:0,after:0,correctedRuns:0};
    day.before += row.total_tokens ?? 0; day.after += row.total_tokens ?? 0;
  }
  for (const repair of repairs) {
    const day = days[repair.before.completed_at.slice(0,10)];
    day.after += repair.turn.usage.inputTokens + repair.turn.usage.outputTokens - (repair.before.total_tokens ?? 0);
    day.correctedRuns++;
  }
  let updatedChats = 0;
  if (options.apply && repairs.length) {
    const metadataBackups: Array<{chatId:string;messageId:string;metadata:unknown}> = [];
    const chats = db.prepare("SELECT id,data FROM chats WHERE owner_id=?").all(ownerId) as Array<{id:string;data:string}>;
    const repairIds = new Set(repairs.map(repair => repair.before.message_id));
    for (const row of chats) {
      const chat = JSON.parse(row.data);
      for (const message of chat.messages || []) {
        if (repairIds.has(message.id) && message.role === "assistant") metadataBackups.push({chatId:row.id,messageId:message.id,metadata:message.runMetadata});
      }
    }
    mkdirSync(path.dirname(options.backupPath!), { recursive: true, mode: 0o700 });
    writeFileSync(options.backupPath!, JSON.stringify({createdAt:new Date().toISOString(),ownerId,repairs,metadataBackups},null,2)+"\n", { flag:"wx",mode:0o600 });
    const repaired = new Map(repairs.map(repair => [repair.before.message_id,repair]));
    db.exec("BEGIN IMMEDIATE");
    try {
      const update = db.prepare("UPDATE account_usage SET input_tokens=?,output_tokens=?,total_tokens=?,cached_input_tokens=?,cache_write_input_tokens=? WHERE owner_id=? AND message_id=? AND input_tokens IS ? AND output_tokens IS ? AND total_tokens IS ?");
      for (const repair of repairs) {
        const {before,turn:{usage}} = repair;
        const result = update.run(usage.inputTokens,usage.outputTokens,usage.inputTokens+usage.outputTokens,usage.cachedInputTokens??null,usage.cacheWriteInputTokens??null,ownerId,before.message_id,before.input_tokens,before.output_tokens,before.total_tokens);
        if (Number(result.changes) !== 1) throw new Error("Usage changed during repair; retry from a fresh dry run");
      }
      // Re-read inside the transaction and retain composer, queue, active runs and every unrelated field.
      for (const row of db.prepare("SELECT id,data FROM chats WHERE owner_id=?").all(ownerId) as Array<{id:string;data:string}>) {
        const chat = JSON.parse(row.data);
        let changed = false;
        for (const message of chat.messages || []) {
          const repair = repaired.get(message.id);
          if (!repair || message.role !== "assistant") continue;
          const meta = message.runMetadata;
          if (!meta || meta.providerId !== "codex" || meta.inputTokens !== repair.before.input_tokens || meta.outputTokens !== repair.before.output_tokens) continue;
          const usage = repair.turn.usage;
          message.runMetadata = {...meta,...usage,totalTokens:usage.inputTokens+usage.outputTokens,tokenUsageScope:"turn"};
          delete message.runMetadata.totalProcessedTokens;
          changed = true;
        }
        if (changed) {
          const now = new Date().toISOString();
          chat.updatedAt = now;
          db.prepare("UPDATE chats SET data=?,updated_at=? WHERE id=? AND owner_id=?").run(JSON.stringify(chat),now,row.id,ownerId);
          updatedChats++;
        }
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  return { applied:Boolean(options.apply),files,rows:rows.length,proven,unmatched,corrected:repairs.length,updatedChats,days };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args[args.indexOf(name)+1];
  const ownerId = args.includes("--owner") ? value("--owner") : undefined;
  if (!ownerId) throw new Error("Specify --owner <account-id>");
  const apply = args.includes("--apply");
  const db = new DatabaseSync(config.databasePath,{readOnly:!apply,timeout:10000});
  try { console.log(JSON.stringify(await repairCodexUsage({db,ownerId,dataDir:config.dataDir,apply,backupPath:args.includes("--backup")?value("--backup"):undefined}),null,2)); }
  finally { db.close(); }
}

if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1; });
