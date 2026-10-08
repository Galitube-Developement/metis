import { consumeRateLimit, requestClientAddress, resetRateLimit } from "@/lib/rate-limit";

export function consumeSharePasswordLimit(req: Request, shareId: string) {
  const addressKey = "share:address:" + requestClientAddress(req) + ":" + shareId;
  const targetKey = "share:target:" + shareId;
  const address = consumeRateLimit(addressKey, 10, 15 * 60 * 1000);
  const target = consumeRateLimit(targetKey, 30, 15 * 60 * 1000);
  return {
    allowed: address.allowed && target.allowed,
    retryAfterSeconds: Math.max(address.retryAfterSeconds, target.retryAfterSeconds),
    reset: () => { resetRateLimit(addressKey); resetRateLimit(targetKey); },
  };
}
