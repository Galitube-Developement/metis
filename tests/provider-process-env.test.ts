import assert from "node:assert/strict";
import test from "node:test";
import { providerProcessEnv } from "../lib/providers/process-env";

test("provider processes inherit only operational environment values", () => {
  const env = providerProcessEnv(
    {
      CODEX_HOME: "/safe/codex",
      METIS_MCP_SESSION_TOKEN: "scoped-session-token",
      OPTIONAL_VALUE: undefined,
    },
    {
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      HTTPS_PROXY: "http://proxy.invalid",
      AI_CHAT_SECRETS_KEY: "application-secret",
      CHAT_PASSWORD: "login-secret",
      MCP_BEARER_TOKEN: "root-mcp-secret",
      DATABASE_URL: "sqlite:///private",
      NODE_OPTIONS: "--require=/tmp/inject.js",
    },
  );

  assert.deepEqual(env, {
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    HTTPS_PROXY: "http://proxy.invalid",
    CODEX_HOME: "/safe/codex",
    METIS_MCP_SESSION_TOKEN: "scoped-session-token",
  });
  assert.equal("AI_CHAT_SECRETS_KEY" in env, false);
  assert.equal("CHAT_PASSWORD" in env, false);
  assert.equal("MCP_BEARER_TOKEN" in env, false);
  assert.equal("DATABASE_URL" in env, false);
  assert.equal("NODE_OPTIONS" in env, false);
});
