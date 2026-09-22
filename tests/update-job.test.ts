import assert from "node:assert/strict";
import test from "node:test";
import { installerJobFinishedMessage, pollInstallerJob } from "../lib/update-job-client";
import { settleUpdateJobFromInstaller } from "../lib/update-job";

const preparing = {
  jobId: "job-1",
  status: "preparing" as const,
  startedAt: "2026-09-13T20:00:00.000Z",
  logs: ["started"],
};

test("settlement keeps preparing while the installer unit is running", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: true,
    logText: "Building...",
  });
  assert.equal(next.status, "preparing");
});

test("settlement keeps preparing before the installer unit has started", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: "",
  });
  assert.equal(next.status, "preparing");
  assert.equal(next.finishedAt, undefined);
});

test("settlement marks ready after the installer restarts Metis", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: "Metis AI installed successfully.\nOpen: http://127.0.0.1:3100",
    now: "2026-09-13T21:00:00.000Z",
  });
  assert.equal(next.status, "ready");
  assert.equal(next.finishedAt, "2026-09-13T21:00:00.000Z");
});

test("settlement marks failed when the installer log has an error", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: "Error: git pull failed",
  });
  assert.equal(next.status, "failed");
});

test("a 404 job poll clears once Metis is serving and maintenance is off", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/admin/system/update?job=")) return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
    if (url.includes("/api/system/maintenance")) return new Response(JSON.stringify({ active: false }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const job = await pollInstallerJob("lost-after-restart");
    assert.equal(job.status, "ready");
    assert.match(installerJobFinishedMessage(), /running again/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
