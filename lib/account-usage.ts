import { getDatabase, transaction } from "@/lib/sqlite";
import type { ChatMessage } from "@/lib/store";
import type { AccountUsage, UsageTotals, UsageDay, UsageModel, UsageModelDetails, UsageConfigurationCounts, UsageBucket } from "@/lib/account-types";
import { usageConfiguration } from "@/lib/usage-configuration";
import { apiPriceIndex, resolveApiPrice, estimateApiValue, API_PRICE_SOURCE, type PricingSnapshot } from "@/lib/usage-cost-estimate";
import { getProviderDefinition } from "@/lib/providers/registry";
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
    (owner_id,message_id,model_id,provider_id,completed_at,input_tokens,output_tokens,total_tokens,cost_usd,context_window,reasoning_effort,speed_mode,cached_input_tokens,cache_write_input_tokens)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,message_id) DO UPDATE SET
    model_id=excluded.model_id,provider_id=excluded.provider_id,completed_at=excluded.completed_at,
    input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
    total_tokens=excluded.total_tokens,cost_usd=excluded.cost_usd,
    cached_input_tokens=COALESCE(excluded.cached_input_tokens,account_usage.cached_input_tokens),
    cache_write_input_tokens=COALESCE(excluded.cache_write_input_tokens,account_usage.cache_write_input_tokens),
    context_window=COALESCE(excluded.context_window,account_usage.context_window),
    reasoning_effort=COALESCE(excluded.reasoning_effort,account_usage.reasoning_effort),
    speed_mode=COALESCE(excluded.speed_mode,account_usage.speed_mode)`)
    .run(ownerId, message.id, meta.modelId || "Unknown model", meta.providerId || "Unknown provider",
      new Date(meta.completedAt).toISOString(), input, output, tokens, measured(meta.costUsd),
      measured(meta.configuredContextWindow) || (meta.contextWindowSource !== "inferred" && meta.contextWindowSource !== "estimate" ? measured(meta.contextWindow) : null) || null,
      typeof meta.reasoningEffort === "string" ? meta.reasoningEffort.slice(0,64) : null,
      typeof meta.speedMode === "string" ? meta.speedMode.slice(0,64) : null,
      measured(meta.cachedInputTokens),measured(meta.cacheWriteInputTokens));
}

/** Incremental migration from owned transcripts. Never reads the global routing telemetry. */
export function syncAccountUsage(ownerId: string) {
  transaction(() => {
    const db = getDatabase();
    const rows = db.prepare(`SELECT c.id,c.created_at,c.updated_at FROM chats c
      LEFT JOIN account_usage_sync s ON s.owner_id=c.owner_id AND s.chat_id=c.id
      WHERE c.owner_id=? AND (s.revision IS NULL OR s.revision<>('api-value-v2:'||c.updated_at))`).all(ownerId) as Array<{id:string;created_at:string;updated_at:string}>;
    for (const row of rows) {
      const messages = db.prepare(`SELECT json_extract(m.value,'$.id') AS id,
        json_extract(m.value,'$.runMetadata') AS metadata,
        (SELECT json_extract(j.data,'$.modelParams') FROM run_events e JOIN jobs j ON j.id=e.job_id
          WHERE e.chat_id=c.id AND e.user_id=c.owner_id AND j.user_id=c.owner_id
            AND e.event='assistantId' AND json_extract(e.data,'$.messageId')=json_extract(m.value,'$.id')
          ORDER BY e.id DESC LIMIT 1) AS params FROM chats c,json_each(c.data,'$.messages') m
        WHERE c.id=? AND c.owner_id=? AND json_extract(m.value,'$.role')='assistant'
        AND json_type(m.value,'$.runMetadata')='object'`).all(row.id, ownerId) as Array<{id:string;metadata:string;params:string|null}>;
      for (const message of messages) {
        const metadata = JSON.parse(message.metadata) as NonNullable<ChatMessage["runMetadata"]>;
        // A shared chat clone contains someone else's historical answers, not new consumption.
        if (Date.parse(metadata.completedAt) < Date.parse(row.created_at)) continue;
        recordAccountUsage(ownerId, { id:message.id, role:"assistant", runMetadata:{
          ...usageConfiguration(message.params ? JSON.parse(message.params) : undefined),
          ...metadata,
        } });
      }
      db.prepare("INSERT INTO account_usage_sync(owner_id,chat_id,revision) VALUES(?,?,?) ON CONFLICT(owner_id,chat_id) DO UPDATE SET revision=excluded.revision").run(ownerId,row.id,"api-value-v2:"+row.updated_at);
    }
  });
}

export function usageRange(from: string | null, to: string | null, now = new Date()) {
  const end = to || now.toISOString().slice(0,10);
  const start = from || new Date(Date.parse(end) - 29 * DAY).toISOString().slice(0,10);
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  if (!valid(start) || !valid(end) || start > end || Date.parse(end)-Date.parse(start) > 365 * DAY)
    throw new Error("Choose a valid date range of up to one year.");
  return { from:start, to:end };
}
const empty = (): UsageTotals => ({ requests:0,inputTokens:0,outputTokens:0,tokens:0,costUsd:null,estimatedCostUsd:null,estimatedCostReports:0,tokenReports:0,costReports:0,inputReports:0,outputReports:0 });
type Row = { model_id:string;provider_id:string;completed_at:string;input_tokens:number|null;output_tokens:number|null;total_tokens:number|null;cost_usd:number|null;cached_input_tokens:number|null;cache_write_input_tokens:number|null;context_window:number|null;reasoning_effort:string|null;speed_mode:string|null };
function add(target: UsageTotals, row: Row, estimate: number|null = null) {
  if(estimate!==null) {target.estimatedCostUsd=(target.estimatedCostUsd??0)+estimate;target.estimatedCostReports=(target.estimatedCostReports??0)+1;}
  target.requests++;
  if (row.input_tokens !== null) target.inputReports++;
  if (row.output_tokens !== null) target.outputReports++;
  target.inputTokens += row.input_tokens ?? 0;
  target.outputTokens += row.output_tokens ?? 0;
  target.tokens += row.total_tokens ?? 0;
  if (row.total_tokens !== null) target.tokenReports++;
  if (row.cost_usd !== null) { target.costUsd=(target.costUsd ?? 0)+row.cost_usd; target.costReports++; }
}
export function getAccountUsage(ownerId: string, from: string | null = null, to: string | null = null, pricing: PricingSnapshot | null = null, excludedProviders: readonly string[] = []): AccountUsage {
  const prices=apiPriceIndex(pricing);
  const range=usageRange(from,to);
  syncAccountUsage(ownerId);
  const rows=getDatabase().prepare("SELECT * FROM account_usage WHERE owner_id=? AND completed_at>=? AND completed_at<? ORDER BY completed_at")
    .all(ownerId,range.from+"T00:00:00.000Z",new Date(Date.parse(range.to)+DAY).toISOString()) as Row[];
  const days=new Map<string,UsageDay>();
  for(let timestamp=Date.parse(range.from);timestamp<=Date.parse(range.to);timestamp+=DAY) {
    const date=new Date(timestamp).toISOString().slice(0,10); days.set(date,{...empty(),date});
  }
  const models=new Map<string,UsageModel>(),totals=empty();
  const providers=new Map<string,{id:string;name:string;requests:number}>();
  const excluded=new Set(excludedProviders);
  for(const row of rows) {
    const provider=providers.get(row.provider_id) || {id:row.provider_id,name:getProviderDefinition(row.provider_id)?.name || row.provider_id,requests:0};
    provider.requests++;providers.set(provider.id,provider);
    if(excluded.has(row.provider_id))continue;
    const price=resolveApiPrice(row.provider_id,row.model_id,prices);
    const estimate=estimateRow(row,price);
    add(totals,row,estimate); add(days.get(row.completed_at.slice(0,10))!,row,estimate);
    const key=JSON.stringify([row.provider_id,row.model_id]);
    const model=models.get(key) || {...empty(),modelId:row.model_id,providerId:row.provider_id};
    add(model,row,estimate);if(price)model.apiPrice=price;models.set(key,model);
  }
  return {...range,timezone:"UTC",...(pricing?{pricing:{sourceUrl:API_PRICE_SOURCE,checkedAt:pricing.checkedAt}}:{}),totals,providers:[...providers.values()].sort((a,b)=>a.name.localeCompare(b.name)),days:[...days.values()],models:[...models.values()].sort((a,b)=>b.tokens-a.tokens)};
}

function estimateRow(row: Row, price: ReturnType<typeof resolveApiPrice>) {
  return estimateApiValue({input:row.input_tokens,output:row.output_tokens,cached:row.cached_input_tokens,cacheWrite:row.cache_write_input_tokens},price,getProviderDefinition(row.provider_id)?.apiPricing?.inputIncludesCache);
}

const emptyConfigurations = (): UsageConfigurationCounts => ({context:[],reasoning:[],speed:[]});
function countConfiguration(buckets: UsageBucket[], value: string | null) {
  const existing=buckets.find(bucket=>bucket.value===value);
  if(existing) existing.requests++;
  else buckets.push({value,requests:1});
}
function addConfiguration(target: UsageConfigurationCounts, row: Row) {
  countConfiguration(target.context,row.context_window ? String(row.context_window) : null);
  countConfiguration(target.reasoning,row.reasoning_effort || null);
  countConfiguration(target.speed,row.speed_mode || null);
}
export function getAccountModelUsage(
  ownerId: string, providerId: string, modelId: string, from: string | null = null, to: string | null = null, pricing: PricingSnapshot|null = null,
): UsageModelDetails | null {
  const range=usageRange(from,to);
  syncAccountUsage(ownerId);
  const rows=getDatabase().prepare(`SELECT * FROM account_usage
    WHERE owner_id=? AND provider_id=? AND model_id=? AND completed_at>=? AND completed_at<?
    ORDER BY completed_at`).all(ownerId,providerId,modelId,range.from+"T00:00:00.000Z",new Date(Date.parse(range.to)+DAY).toISOString()) as Row[];
  if(!rows.length)return null;
  const price=resolveApiPrice(providerId,modelId,apiPriceIndex(pricing));
  const details: UsageModelDetails={...empty(),...(price?{apiPrice:price}:{}),modelId,providerId,...range,timezone:"UTC",configurations:emptyConfigurations(),days:[]};
  const days=new Map<string,UsageModelDetails["days"][number]>();
  for(let timestamp=Date.parse(range.from);timestamp<=Date.parse(range.to);timestamp+=DAY) {
    const date=new Date(timestamp).toISOString().slice(0,10);
    days.set(date,{...empty(),date,configurations:emptyConfigurations()});
  }
  for(const row of rows) {
    const day=days.get(row.completed_at.slice(0,10))!;
    const estimate=estimateRow(row,price);add(details,row,estimate);add(day,row,estimate);
    addConfiguration(details.configurations,row);addConfiguration(day.configurations,row);
  }
  for(const buckets of Object.values(details.configurations))buckets.sort((a,b)=>b.requests-a.requests);
  details.days=[...days.values()];
  return details;
}
