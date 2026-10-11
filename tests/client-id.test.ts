import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createClientId } from "../lib/client-id";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("client IDs work on HTTP where Web Crypto lacks randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const httpCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: httpCrypto });
  try {
    const ids = Array.from({ length: 1000 }, () => createClientId());
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, uuidV4);
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("client IDs also work with native randomUUID", () => {
  assert.match(createClientId(), uuidV4);
});
