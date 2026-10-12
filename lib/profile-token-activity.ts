import type { UsageDay } from "./account-types";
import { usageTokenOptions, usageTokenReports, usageTokenValue } from "./usage-token-split";
export type TokenActivityDay = Pick<UsageDay,"date"|"tokens">;
const fullDate = new Intl.DateTimeFormat("en",{weekday:"long",year:"numeric",month:"short",day:"numeric",timeZone:"UTC"});
export function tokenActivityDate(date:string) {
  const value=new Date(date+"T00:00:00Z");
  return Number.isFinite(value.getTime()) ? fullDate.format(value) : date;
}
/** Explicit public DTO: never pass private usage details to the shared profile client. */
export function publicTokenActivity(days:readonly UsageDay[]):TokenActivityDay[] {
  return days.map(({date,tokens})=>({date,tokens}));
}
export function tokenActivityDetails(day:TokenActivityDay,usage?:UsageDay) {
  const total=usage ? usageTokenValue(usage,"tokens") : day.tokens;
  const rows=usage ? usageTokenOptions.slice(1).map(option=>({
    label:option.label,value:usageTokenValue(usage,option.key),reports:usageTokenReports(usage,option.key),
  })) : [];
  return {date:tokenActivityDate(day.date),total,rows,requests:usage?.requests,
    tokenReports:usage?.tokenReports,partial:Boolean(usage && usage.tokenReports<usage.requests)};
}
