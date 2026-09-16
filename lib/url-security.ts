import dns from "node:dns/promises";
import net from "node:net";

export type UrlLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;
export type PrivateUrlPolicy = (url: URL) => boolean;

const BLOCKED_METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google",
  "metadata.google.internal",
]);

function ipv4Number(address: string) {
  if (!net.isIPv4(address)) return null;
  return address.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function inIpv4Range(value: number, network: string, prefix: number) {
  const base = ipv4Number(network);
  if (base === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv6Bytes(address: string) {
  let value = address.toLowerCase().split("%", 1)[0];
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const ipv4 = ipv4Number(dotted);
    if (ipv4 === null) return null;
    value = `${value.slice(0, -dotted.length)}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  if (!net.isIPv6(value) || value.split("::").length > 2) return null;
  const [leftRaw, rightRaw = ""] = value.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!value.includes("::") && missing !== 0)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.flatMap((part) => {
    const word = Number.parseInt(part, 16);
    return [word >>> 8, word & 0xff];
  });
}

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = ipv4Number(normalized);
  if (ipv4 !== null) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.31.196.0", 24],
      ["192.52.193.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["192.175.48.0", 24],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([network, prefix]) => inIpv4Range(ipv4, network as string, prefix as number));
  }

  const bytes = ipv6Bytes(normalized);
  if (!bytes) return false;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const embeddedIpv4 = bytes.slice(0, 12).every((byte) => byte === 0)
    || bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (embeddedIpv4) {
    const embedded = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    if (isPrivateAddress(embedded)) return true;
  }
  return allZero
    || loopback
    || (bytes[0] & 0xfe) === 0xfc
    || bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80
    || bytes[0] === 0xff
    || bytes[0] === 0x01 && bytes.slice(1, 8).every((byte) => byte === 0)
    || bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
    || bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] <= 0x01
    || bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8
    || bytes[0] === 0x20 && bytes[1] === 0x02;
}

export function privateUrlAllowlist(raw = process.env.VOICE_TRANSCRIPTION_PRIVATE_BASE_URLS || ""): PrivateUrlPolicy {
  const allowed = raw.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    try {
      const url = new URL(entry);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
      return [url];
    } catch {
      return [];
    }
  });
  return (target) => allowed.some((base) => {
    if (target.origin !== base.origin) return false;
    const prefix = base.pathname.replace(/\/+$/, "") || "/";
    return prefix === "/" || target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
  });
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  options: {
    lookup?: UrlLookup;
    allowPrivateUrl?: PrivateUrlPolicy;
    requireHttps?: boolean;
  } = {},
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_METADATA_HOSTS.has(hostname)) throw new Error("Private URL");
  const allowPrivate = options.allowPrivateUrl?.(url) === true;
  const lookup = options.lookup || ((name) => dns.lookup(name, { all: true }));
  if (options.requireHttps && url.protocol !== "https:" && !allowPrivate) {
    throw new Error("External URLs must use HTTPS");
  }
  if (isPrivateAddress(hostname) && !allowPrivate) throw new Error("Private URL");

  const addresses = await lookup(hostname);
  if (!addresses.length || !allowPrivate && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Private URL");
  }
  return url;
}

export async function readResponseTextBounded(response: Response, maxBytes: number) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - total;
      const chunk = next.value.byteLength > remaining ? next.value.slice(0, remaining) : next.value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < next.value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export async function fetchWithValidatedRedirects(
  rawUrl: string,
  init: RequestInit = {},
  options: { lookup?: UrlLookup; maxRedirects?: number; fetcher?: FetchLike; allowPrivateUrl?: PrivateUrlPolicy } = {},
) {
  const fetcher = options.fetcher || fetch;
  const maxRedirects = options.maxRedirects ?? 4;
  let target = await assertPublicHttpUrl(rawUrl, {
    lookup: options.lookup,
    allowPrivateUrl: options.allowPrivateUrl,
  });
  for (let redirects = 0; ; redirects += 1) {
    // Resolve again immediately before every connection. This narrows the DNS
    // rebinding window and ensures every redirect hop gets a fresh policy check.
    target = await assertPublicHttpUrl(target.toString(), {
      lookup: options.lookup,
      allowPrivateUrl: options.allowPrivateUrl,
    });
    const response = await fetcher(target, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, url: target };
    }
    if (redirects >= maxRedirects) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect without location");
    const redirected = new URL(location, target);
    const validatedRedirect = await assertPublicHttpUrl(redirected.toString(), {
      lookup: options.lookup,
      allowPrivateUrl: options.allowPrivateUrl,
    });
    if (validatedRedirect.origin !== target.origin) throw new Error("Cross-origin redirects are not allowed");
    target = validatedRedirect;
  }
}
