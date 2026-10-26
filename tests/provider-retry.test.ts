import assert from "node:assert/strict";
import test from "node:test";
import { isTransientProviderError, providerRetryDetail } from "../lib/provider-retry";

test("explicit transient provider evidence survives SDK error wrapping", () => {
  for (const error of [
    new Error("Model is under capacity"),
    new Error("Model is temporarily unavailable"),
    { statusCode: 503, message: "Unavailable" },
    { statusCode: 502, message: "Bad Gateway" },
    new Error("HTTP 502 Bad Gateway", { cause: { statusCode: 502 } }),
    { statusCode: 529 },
    { code: "overloaded_error" },
    new Error("SDK request failed", { cause: { code: "ECONNRESET" } }),
    { responseBody: JSON.stringify({ error: { type: "overloaded_error" } }) },
  ]) assert.equal(isTransientProviderError(error), true, JSON.stringify(error));
  assert.equal(providerRetryDetail(new Error("Request failed", { cause: new Error("Model is under capacity") })),
    "Request failed\n\nModel is under capacity");
});

test("usage, billing, authentication, tool and unknown failures never become automatic retries", () => {
  for (const error of [
    new Error("Unknown failure"),
    new Error("MCP gateway temporarily unavailable"),
    { statusCode: 503, message: "Metis gateway temporarily unavailable" },
    { statusCode: 503, message: "MCP tool call failed" },
    { name: "ToolExecutionError", cause: { statusCode: 503 } },
    { toolName: "execute_command", cause: { code: "ETIMEDOUT" } },
    { toolCallId: "call-1", message: "Model is under capacity" },
    { statusCode: 429, message: "Model is under capacity" },
    new Error("You've hit your usage limit. Try again later."),
    new Error("SDK failure", { cause: { code: "usage_limit_reached" } }),
    { statusCode: 401, message: "Model is under capacity" },
    { statusCode: 403, cause: { statusCode: 503 } },
    { code: "insufficient_quota", cause: { statusCode: 503 } },
    { code: "billing_hard_limit_reached", message: "Model is under capacity" },
    { code: "invalid_api_key", message: "Model is under capacity" },
  ]) assert.equal(isTransientProviderError(error), false, JSON.stringify(error));
});
