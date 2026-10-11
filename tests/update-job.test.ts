import assert from "node:assert/strict";
import test from "node:test";
import { installerJobFinishedMessage, pollInstallerJob, reloadCompletedInstallerJob, UPDATE_JOB_STORAGE_KEY } from "../lib/update-job-client";
import { installerUpdateJobMarker } from "../lib/installer-update";
import { settleUpdateJobFromInstaller } from "../lib/update-job";

const preparing = {
  jobId: "job-1",
  status: "preparing" as const,
  startedAt: "2026-09-13T20:00:00.000Z",
  startedByPid: 100,
  logs: ["started"],
};

const marker = installerUpdateJobMarker(preparing.jobId);

test("settlement keeps preparing while the installer unit is running", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: true,
    logText: `${marker}\nBuilding...`,
    currentPid: 100,
  });
  assert.equal(next.status, "preparing");
});

test("settlement ignores a stale success log from another update", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: "Metis AI installed successfully.",
    currentPid: 200,
  });
  assert.equal(next.status, "preparing");
  assert.equal(next.finishedAt, undefined);
});

test("settlement marks ready after the installer restarts Metis", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: `${marker}\nMetis AI installed successfully.\nOpen: http://127.0.0.1:3100`,
    currentPid: 200,
    now: "2026-09-13T21:00:00.000Z",
  });
  assert.equal(next.status, "ready");
  assert.equal(next.finishedAt, "2026-09-13T21:00:00.000Z");
});

test("settlement stays preparing until Metis runs in a new process", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: `${marker}\nMetis AI installed successfully.`,
    currentPid: 100,
  });
  assert.equal(next.status, "preparing");
  assert.equal(next.finishedAt, undefined);
});

test("settlement marks failed when the installer log has an error", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: `${marker}\nError: git pull failed`,
    currentPid: 100,
  });
  assert.equal(next.status, "failed");
});

test("a missing job never reports a successful update", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/admin/system/update?job=")) return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
    if (url.includes("/api/system/maintenance")) return new Response(JSON.stringify({ active: false }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const job = await pollInstallerJob("lost-after-restart");
    assert.equal(job.status, "failed");
    assert.match(job.error || "", /could not be verified/i);
    assert.match(installerJobFinishedMessage(), /running again/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful update reloads once and consumes the job before navigation", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[UPDATE_JOB_STORAGE_KEY, "completed-job"]]);
  let reloads = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    },
    location: { reload: () => {
      assert.equal(values.has(UPDATE_JOB_STORAGE_KEY), false);
      reloads++;
    } },
  } });
  try {
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "preparing" }), false);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "restarting" }), false);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "failed" }), false);
    assert.equal(values.get(UPDATE_JOB_STORAGE_KEY), "completed-job");
    assert.equal(reloads, 0);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "ready" }), true);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "ready" }), false);
    assert.equal(reloads, 1);
    // A late result from an old job must not consume a newer pending update.
    values.set(UPDATE_JOB_STORAGE_KEY, "new-job");
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "ready" }), false);
    assert.equal(values.get(UPDATE_JOB_STORAGE_KEY), "new-job");
    assert.equal(reloads, 1);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("update completion is safe outside the browser", () => {
  assert.equal(reloadCompletedInstallerJob("job", { status: "ready" }), false);
});
