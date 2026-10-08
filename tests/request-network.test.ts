import assert from "node:assert/strict";
import http, { type IncomingMessage } from "node:http";
import { once } from "node:events";
import test, { after } from "node:test";
import {
  initializeRequestNetwork, stampRequestNetwork, requestClientAddress,
  socketClientAddress, socketRequestProtocol, isTrustedProxy,
  browserStreamOriginAllowed, requestIsSecure,
} from "../lib/request-network";

const previousTrust = process.env.AI_CHAT_TRUSTED_PROXIES;
const previousPublic = process.env.AI_CHAT_PUBLIC_URL;
after(() => {
  if (previousTrust === undefined) delete process.env.AI_CHAT_TRUSTED_PROXIES;
  else process.env.AI_CHAT_TRUSTED_PROXIES = previousTrust;
  if (previousPublic === undefined) delete process.env.AI_CHAT_PUBLIC_URL;
  else process.env.AI_CHAT_PUBLIC_URL = previousPublic;
  delete process.env.AI_CHAT_BROWSER_ALLOWED_ORIGINS;
});
initializeRequestNetwork();
function incoming(peer: string, headers: Record<string, string> = {}) {
  return { socket: { remoteAddress: peer }, headers } as IncomingMessage;
}

test("direct peers cannot spoof forwarded or internal metadata", async () => {
  delete process.env.AI_CHAT_TRUSTED_PROXIES;
  const server = http.createServer((req, res) => {
    stampRequestNetwork(req);
    const request = new Request("http://localhost/", { headers: req.headers as Record<string, string> });
    res.end(JSON.stringify({ address: requestClientAddress(request), secure: requestIsSecure(request) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    for (let index = 0; index < 3; index++) {
      const res = await fetch("http://127.0.0.1:" + port, { headers: {
        "x-real-ip": "198.51.100." + index, "x-forwarded-for": "203.0.113." + index,
        "x-forwarded-proto": "https", "x-metis-network": "fake.fake",
      } });
      assert.deepEqual(await res.json(), { address: "127.0.0.1", secure: false });
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  const forged = new Request("http://localhost", { headers: { "x-metis-network": "fake.fake", "x-real-ip": "1.2.3.4" } });
  assert.equal(requestClientAddress(forged), "unknown");
});

test("proxy CIDRs use the first untrusted hop from the actual socket", () => {
  process.env.AI_CHAT_TRUSTED_PROXIES = "127.0.0.1,10.0.0.0/8,::1";
  assert.equal(isTrustedProxy("::ffff:127.0.0.1"), true);
  assert.equal(isTrustedProxy("10.1.2.3"), true);
  assert.equal(isTrustedProxy("192.0.2.1"), false);
  assert.equal(isTrustedProxy("2001:db8::1", "2001:db8::/32"), true);
  assert.equal(socketClientAddress(incoming("127.0.0.1", { "x-forwarded-for": "1.2.3.4, 198.51.100.7, 10.0.0.2" })), "198.51.100.7");
  assert.equal(socketClientAddress(incoming("192.0.2.5", { "x-forwarded-for": "1.2.3.4" })), "192.0.2.5");
  assert.equal(socketClientAddress(incoming("127.0.0.1", { "x-forwarded-for": "invalid, 10.0.0.2", "x-real-ip": "1.2.3.4" })), "127.0.0.1");
  assert.equal(socketClientAddress(incoming("127.0.0.1", { "x-real-ip": "1.2.3.4" })), "127.0.0.1");
  assert.throws(() => isTrustedProxy("127.0.0.1", "0.0.0.0/no"), /Invalid/);
});

test("signed metadata carries proxy address and TLS without trusting route headers", () => {
  process.env.AI_CHAT_TRUSTED_PROXIES = "127.0.0.1";
  const incomingRequest = incoming("127.0.0.1", { "x-forwarded-for": "198.51.100.8", "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" });
  stampRequestNetwork(incomingRequest);
  assert.equal(incomingRequest.headers["x-forwarded-host"], undefined);
  const req = new Request("http://internal/", { headers: incomingRequest.headers as Record<string, string> });
  assert.equal(requestClientAddress(req), "198.51.100.8");
  assert.equal(requestIsSecure(req), true);
  req.headers.set("x-metis-network", req.headers.get("x-metis-network")!.slice(0, -1) + "z");
  assert.equal(requestClientAddress(req), "unknown");
  assert.equal(requestIsSecure(req), false);
  delete process.env.AI_CHAT_TRUSTED_PROXIES;
  assert.equal(socketRequestProtocol(incoming("127.0.0.1", { "x-forwarded-proto": "https" })), "http");
});

test("browser stream rejects missing, null, sibling-site and lookalike origins", () => {
  delete process.env.AI_CHAT_TRUSTED_PROXIES;
  process.env.AI_CHAT_PUBLIC_URL = "https://metis.example";
  const host = { host: "127.0.0.1:3100" };
  for (const origin of ["", "null", "https://evil.metis.example", "https://metis.example.evil", "https://metis.example/path"]) {
    assert.equal(browserStreamOriginAllowed(incoming("127.0.0.1", { ...host, origin })), false, origin);
  }
  assert.equal(browserStreamOriginAllowed(incoming("127.0.0.1", { ...host, origin: "https://metis.example" })), true);
  assert.equal(browserStreamOriginAllowed(incoming("127.0.0.1", { ...host, origin: "http://127.0.0.1:3100" })), true);
  process.env.AI_CHAT_BROWSER_ALLOWED_ORIGINS = "https://approved.example";
  assert.equal(browserStreamOriginAllowed(incoming("127.0.0.1", { ...host, origin: "https://approved.example" })), true);
});
