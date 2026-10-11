/** Decode only object payloads; callers choose their provider's JSON nesting limit. */
export function payloadRecord(value: unknown, jsonDepth = 1): Record<string, unknown> {
  if (typeof value === "string") {
    if (jsonDepth <= 0 || !value.trim()) return {};
    try { return payloadRecord(JSON.parse(value) as unknown, jsonDepth - 1); }
    catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Flatten provider message blocks without changing strings, ordering or scalar values. */
export function payloadText(value: unknown, jsonDepth = 1): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const block = payloadRecord(item, jsonDepth);
      return payloadText(block.text ?? block.content ?? block.message, jsonDepth);
    }).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    const block = payloadRecord(value, jsonDepth);
    return payloadText(block.text ?? block.content ?? block.message, jsonDepth);
  }
  return value == null ? "" : String(value);
}
