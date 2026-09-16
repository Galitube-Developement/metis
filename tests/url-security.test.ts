import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicHttpUrl,
  fetchWithValidatedRedirects,
  isPrivateAddress,
  privateUrlAllowlist,
  readResponseTextBounded,
} from "../lib/url-security";

test("URL policy blocks private, link-local, CGNAT, multicast, and mapped IPv4 addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "2001:db8::1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("URL policy accepts public HTTPS and rejects credentials and non-HTTP schemes", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const allowed = await assertPublicHttpUrl("https://public.example/path", { lookup });
  assert.equal(allowed.toString(), "https://public.example/path");
  await assert.rejects(assertPublicHttpUrl("https://user:secret@public.example/path", { lookup }), /credentials/i);
  await assert.rejects(assertPublicHttpUrl("file:///etc/passwd", { lookup }), /HTTP and HTTPS/i);
});

test("URL policy blocks loopback, private IPv4, metadata, IPv6 loopback, and mapped IPv4", async () => {
  const blocked = [
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
  ];
  for (const url of blocked) {
    await assert.rejects(assertPublicHttpUrl(url, {
      lookup: async (hostname) => [{ address: hostname === "localhost" ? "127.0.0.1" : hostname, family: 4 }],
    }), /private/i, url);
  }
});

test("private URL allowlist permits only the exact administratively configured prefix", async () => {
  const allowPrivateUrl = privateUrlAllowlist("http://127.0.0.1:9000/v1");
  const allowed = await assertPublicHttpUrl("http://127.0.0.1:9000/v1/audio/transcriptions", {
    allowPrivateUrl,
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  assert.equal(allowed.port, "9000");
  await assert.rejects(assertPublicHttpUrl("http://127.0.0.1:9000/admin", {
    allowPrivateUrl,
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
  }), /private/i);
});

test("URL policy validates every resolved address", async () => {
  await assert.rejects(
    assertPublicHttpUrl("https://public.example", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    }),
    /private/i,
  );
  await assert.rejects(
    assertPublicHttpUrl("http://localhost:8080"),
    /private/i,
  );
});

test("bounded response reader does not consume beyond its limit", async () => {
  const response = new Response("0123456789");
  assert.equal(await readResponseTextBounded(response, 4), "0123");
});

test("redirect validation checks every hop before following it", async () => {
  const calls: string[] = [];
  const lookup = async (hostname: string) => {
    if (hostname === "public.example") return [{ address: "93.184.216.34", family: 4 }];
    throw new Error("private DNS result");
  };
  await assert.rejects(
    fetchWithValidatedRedirects("https://public.example/start", {
      headers: { "x-test": "1" },
    }, {
      lookup,
      fetcher: async (url) => {
        calls.push(url.toString());
        return new Response(null, { status: 302, headers: { location: "http://internal.example/" } });
      },
    }),
    /private DNS result/i,
  );
  assert.deepEqual(calls, ["https://public.example/start"]);
});

test("redirect validation blocks a redirect to a literal private address", async () => {
  const calls: string[] = [];
  await assert.rejects(fetchWithValidatedRedirects("https://public.example/start", {}, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async (url) => {
      calls.push(url.toString());
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    },
  }), /private/i);
  assert.deepEqual(calls, ["https://public.example/start"]);
});

test("redirect validation blocks cross-origin redirects", async () => {
  await assert.rejects(fetchWithValidatedRedirects("https://public.example/start", {}, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async () => new Response(null, {
      status: 307,
      headers: { location: "https://other.example/transcriptions" },
    }),
  }), /cross-origin/i);
});

test("redirect validation permits bounded public redirect chains", async () => {
  const calls: string[] = [];
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await fetchWithValidatedRedirects("https://public.example/start", {}, {
    lookup,
    fetcher: async (url) => {
      calls.push(url.toString());
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "/final" } })
        : new Response("ok", { status: 200 });
    },
  });
  assert.equal(await result.response.text(), "ok");
  assert.deepEqual(calls, ["https://public.example/start", "https://public.example/final"]);
});
