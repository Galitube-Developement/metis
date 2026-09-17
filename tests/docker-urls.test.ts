import test from "node:test";
import assert from "node:assert/strict";
import { isDockerEnv, rewriteDockerServiceUrl } from "../lib/docker-urls.mjs";

test("isDockerEnv accepts common truthy flags", () => {
  assert.equal(isDockerEnv({ METIS_DOCKER: "1" }), true);
  assert.equal(isDockerEnv({ METIS_DOCKER: "true" }), true);
  assert.equal(isDockerEnv({ METIS_DOCKER: "" }), false);
  assert.equal(isDockerEnv({}), false);
});

test("rewriteDockerServiceUrl maps localhost internals onto Docker DNS", () => {
  const docker = { METIS_DOCKER: "1" };
  assert.equal(
    rewriteDockerServiceUrl("http://127.0.0.1:3200/api/internal/mcp-question", "app", 3100, docker),
    "http://app:3100/api/internal/mcp-question",
  );
  assert.equal(
    rewriteDockerServiceUrl("http://localhost:8787", "mcp", 8787, docker),
    "http://mcp:8787",
  );
  assert.equal(
    rewriteDockerServiceUrl("http://192.168.1.10:3100/api/status", "app", 3100, docker),
    "http://192.168.1.10:3100/api/status",
  );
  assert.equal(
    rewriteDockerServiceUrl("http://127.0.0.1:8787", "mcp", 8787, {}),
    "http://127.0.0.1:8787",
  );
});
