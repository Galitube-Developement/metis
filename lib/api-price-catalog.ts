import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { API_PRICE_FEED, parseApiPrices, type PricingSnapshot } from "@/lib/usage-cost-estimate";

const DAY=86_400_000;
let cached: PricingSnapshot|null = null;
let loaded=false, nextAttempt=0;
let pending: Promise<PricingSnapshot|null>|null=null;
const file=path.join(config.dataDir,"api-prices.json");
function validSnapshot(value: unknown): value is PricingSnapshot {
  const snapshot=value as PricingSnapshot;
  return Boolean(snapshot && typeof snapshot.checkedAt==="string" && Number.isFinite(Date.parse(snapshot.checkedAt)) &&
    Array.isArray(snapshot.prices) && snapshot.prices.length &&
    snapshot.prices.every(price=>typeof price.providerId==="string" && typeof price.modelId==="string" &&
      [price.input,price.output].every(rate=>typeof rate==="number" && Number.isFinite(rate) && rate>=0) &&
      [price.cacheRead,price.cacheWrite].every(rate=>rate===undefined || typeof rate==="number" && Number.isFinite(rate) && rate>=0)));
}
function usable(snapshot: PricingSnapshot|null, now: number) {
  const age=snapshot ? now-Date.parse(snapshot.checkedAt) : Infinity;
  return age>=0 && age<=7*DAY ? snapshot : null;
}
/** One shared public-price cache, never account data. Failed refreshes do not fail Usage. */
export async function loadApiPrices(): Promise<PricingSnapshot|null> {
  if(!loaded) {
    loaded=true;
    try {const data=JSON.parse(await readFile(file,"utf8"));if(validSnapshot(data))cached=data;} catch {}
  }
  const now=Date.now();
  if(cached && now-Date.parse(cached.checkedAt)<DAY && usable(cached,now)) return cached;
  if(pending)return pending;
  if(now<nextAttempt)return usable(cached,now);
  nextAttempt=now+300_000;
  pending=(async()=>{
    try {
      const response=await fetch(API_PRICE_FEED,{signal:AbortSignal.timeout(4000),cache:"no-store"});
      if(!response.ok)throw new Error("Price catalog unavailable");
      const fresh=parseApiPrices(await response.json(),new Date(Date.now()).toISOString());
      if(!validSnapshot(fresh))throw new Error("Invalid price catalog");
      cached=fresh;
      try {
        await mkdir(path.dirname(file),{recursive:true});
        const temporary=file+"."+process.pid+".tmp";
        await writeFile(temporary,JSON.stringify(fresh),"utf8");await rename(temporary,file);
      } catch { /* A read-only installation can still use the in-memory catalog. */ }
    } catch { /* Keep a recent cache; never turn unknown prices into zero. */ }
    return usable(cached,Date.now());
  })();
  try {return await pending;} finally {pending=null;}
}
