import { getProviderDefinition } from "@/lib/providers/registry";

export type ApiRates = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
export type ApiPrice = ApiRates & { providerId: string; modelId: string };
export type PricingSnapshot = { checkedAt: string; prices: ApiPrice[] };
export const API_PRICE_SOURCE = "https://models.dev";
export const API_PRICE_FEED = "https://models.dev/api.json";
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const object = (value: unknown): Record<string,unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};

/** Catalog rates are USD per million tokens. Never infer model aliases or prices. */
export function parseApiPrices(payload: unknown, checkedAt = new Date().toISOString()): PricingSnapshot {
  const prices: ApiPrice[] = [];
  for(const [providerId,provider] of Object.entries(object(payload))) {
    for(const [modelId,model] of Object.entries(object(object(provider).models))) {
      const cost = object(object(model).cost);
      if(!measured(cost.input) || !measured(cost.output)) continue;
      prices.push({providerId,modelId,input:cost.input,output:cost.output,
        ...(measured(cost.cache_read) ? {cacheRead:cost.cache_read}:{}),
        ...(measured(cost.cache_write) ? {cacheWrite:cost.cache_write}:{})});
    }
  }
  return {checkedAt,prices};
}
export function apiPriceIndex(snapshot: PricingSnapshot | null) {
  return new Map((snapshot?.prices || []).map(price=>[JSON.stringify([price.providerId,price.modelId]),price]));
}
export function resolveApiPrice(providerId: string, modelId: string, index: ReturnType<typeof apiPriceIndex>): ApiPrice | null {
  const references = getProviderDefinition(providerId)?.apiPricing?.providers;
  if(!references) return null;
  const matches = references.map(provider=>index.get(JSON.stringify([provider,modelId]))).filter((price):price is ApiPrice=>Boolean(price));
  // Multi-provider agent catalogs must resolve to one exact model; ambiguous IDs stay unavailable.
  return matches.length===1 ? matches[0] : null;
}
export function estimateApiValue(
  usage: {input: number|null; output: number|null; cached: number|null; cacheWrite: number|null},
  price: ApiRates | null, inputIncludesCache = true,
): number | null {
  if(!price || !measured(usage.input) || !measured(usage.output)) return null;
  const cached = usage.cached ?? 0, writes = usage.cacheWrite ?? 0;
  if(!measured(cached) || !measured(writes) || (cached>0 && price.cacheRead===undefined) || (writes>0 && price.cacheWrite===undefined)) return null;
  const uncached = usage.input - (inputIncludesCache ? cached+writes : 0);
  if(uncached < 0) return null;
  const value=(uncached*price.input+usage.output*price.output+cached*(price.cacheRead??0)+writes*(price.cacheWrite??0))/1_000_000;
  return Number.isFinite(value) ? value : null;
}
