import { getDatabase, transaction } from "@/lib/sqlite";
import type { ChatMessage } from "@/lib/store";
import type { AccountUsage, UsageTotals, UsageDay, UsageModel } from "@/lib/account-types";
const DAY = 86_400_000;
const measured = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function recordAccountUsage(ownerId: string | undefined, message: Pick<ChatMessage, "id" | "role" | "runMetadata">) {
  const meta = message.runMetadata;
  if (!ownerId || message.role !== "assistant" || !meta || !Number.isFinite(Date.parse(meta.completedAt))) return;
  const input = meta.inputTokensEstimated ? null : measured(meta.inputTokens);
  const output = measured(meta.outputTokens);
  // Context size is never consumption. Cached tokens are already part of provider input totals.
  const tokens = measured(meta.totalProcessedTokens) ?? measured(meta.totalTokens) ??
    (input !== null || output !== null ? (input ?? 0) + (output ?? 0) : null);
  getDatabase().prepare(`INSERT INTO account_usage
    (owner_id,message_id,model_id,provider_id,completed_at,input_tokens,output_tokens,total_tokens,cost_usd)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,message_id) DO UPDATE SET
    model_id=excluded.model_id,provider_id=excluded.provider_id,completed_at=excluded.completed_at,
    input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
    total_tokens=excluded.total_tokens,cost_usd=excluded.cost_usd`)
    .run(ownerId, message.id, meta.modelId || "Unknown model", meta.providerId || "Unknown provider",
      new Date(meta.completedAt).toISOString(), input, output, tokens, measured(meta.costUsd));
}

/** Incremental migration from owned transcripts. Never reads the global routing telemetry. */
export function syncAccountUsage(ownerId: string) {
  transaction(() => {
    const db = getDatabase();
    const rows = db.prepare(`SELECT c.id,c.created_at,c.updated_at FROM chats c
      LEFT JOIN account_usage_sync s ON s.owner_id=c.owner_id AND s.chat_id=c.id
      WHERE c.owner_id=? AND (s.revision IS NULL OR s.revision<>c.updated_at)`).all(ownerId) as Array<{id:string;created_at:string;updated_at:string}>;
    for (const row of rows) {
      const messages = db.prepare(`SELECT json_extract(m.value,'$.id') AS id,
        json_extract(m.value,'$.runMetadata') AS metadata FROM chats c,json_each(c.data,'$.messages') m
        WHERE c.id=? AND c.owner_id=? AND json_extract(m.value,'$.role')='assistant'
        AND json_type(m.value,'$.runMetadata')='object'`).all(row.id, ownerId) as Array<{id:string;metadata:string}>;
      for (const message of messages) {
        const metadata = JSON.parse(message.metadata) as NonNullable<ChatMessage["runMetadata"]>;
        // A shared chat clone contains someone else's historical answers, not new consumption.
        if (Date.parse(metadata.completedAt) < Date.parse(row.created_at)) continue;
        recordAccountUsage(ownerId, { id:message.id, role:"assistant", runMetadata:metadata });
      }
      db.prepare("INSERT INTO account_usage_sync(owner_id,chat_id,revision) VALUES(?,?,?) ON CONFLICT(owner_id,chat_id) DO UPDATE SET revision=excluded.revision").run(ownerId,row.id,row.updated_at);
    }
  });
}

export function usageRange(from: string | null, to: string | null, now = new Date()) {
  const end = to || now.toISOString().slice(0,10);
  const start = from || new Date(Date.parse(end) - 29 * DAY).toISOString().slice(0,10);
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  if (!valid(start) || !valid(end) || start > end || Date.parse(end)-Date.parse(start) > 366 * DAY)
    throw new Error("Choose a valid date range of up to one year.");
  return { from:start, to:end };
}
const empty = (): UsageTotals => ({ requests:0,inputTokens:0,outputTokens:0,tokens:0,costUsd:null,tokenReports:0,costReports:0,inputReports:0,outputReports:0 });
type Row = { model_id:string;provider_id:string;completed_at:string;input_tokens:number|null;output_tokens:number|null;total_tokens:number|null;cost_usd:number|null };
function add(target: UsageTotals, row: Row) {
  target.requests++;
  if (row.input_tokens !== null) target.inputReports++;
  if (row.output_tokens !== null) target.outputReports++;
  target.inputTokens += row.input_tokens ?? 0;
  target.outputTokens += row.output_tokens ?? 0;
  target.tokens += row.total_tokens ?? 0;
  if (row.total_tokens !== null) target.tokenReports++;
  if (row.cost_usd !== null) { target.costUsd=(target.costUsd ?? 0)+row.cost_usd; target.costReports++; }
}
export function getAccountUsage(ownerId: string, from: string | null = null, to: string | null = null): AccountUsage {
  const range=usageRange(from,to);
  syncAccountUsage(ownerId);
  const rows=getDatabase().prepare("SELECT * FROM account_usage WHERE owner_id=? AND completed_at>=? AND completed_at<? ORDER BY completed_at")
    .all(ownerId,range.from+"T00:00:00.000Z",new Date(Date.parse(range.to)+DAY).toISOString()) as Row[];
  const days=new Map<string,UsageDay>();
  for(let timestamp=Date.parse(range.from);timestamp<=Date.parse(range.to);timestamp+=DAY) {
    const date=new Date(timestamp).toISOString().slice(0,10); days.set(date,{...empty(),date});
  }
  const models=new Map<string,UsageModel>(),totals=empty();
  for(const row of rows) {
    add(totals,row); add(days.get(row.completed_at.slice(0,10))!,row);
    const key=JSON.stringify([row.provider_id,row.model_id]);
    const model=models.get(key) || {...empty(),modelId:row.model_id,providerId:row.provider_id};
    add(model,row);models.set(key,model);
  }
  return {...range,timezone:"UTC",totals,days:[...days.values()],models:[...models.values()].sort((a,b)=>b.tokens-a.tokens)};
}
