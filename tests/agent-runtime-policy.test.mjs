import assert from "node:assert/strict";
import test from "node:test";
import { agentRuntimeDeadline, normalizeAgentRuntimeMs, resolveAgentRuntimeMs, scheduleRuntimeDeadline, workerRuntimeMs } from "../lib/agent-runtime-policy.mjs";

test("custom and Unlimited budgets persist without the old six-hour or worker seven-day caps", () => {
  const month = 30 * 24 * 60 * 60_000;
  assert.equal(normalizeAgentRuntimeMs(60_000), 900_000);
  assert.equal(normalizeAgentRuntimeMs(month), month);
  assert.equal(resolveAgentRuntimeMs(undefined, 0), 0);
  assert.equal(resolveAgentRuntimeMs(900_000, 0), 900_000);
  assert.equal(workerRuntimeMs({ parentJobId: "parent", maxRuntimeMs: 0 }, 60_000), 0);
  assert.equal(workerRuntimeMs({ projectTeamId: "team", maxRuntimeMs: month }, 60_000), month);
  assert.equal(workerRuntimeMs({}, 60_000), 60_000);
  assert.equal(agentRuntimeDeadline(Date.now(), 0), Infinity);
});

test("deadlines beyond Node's timer range expire once at the correct time", t => {
  const start = 1_700_000_000_000;
  const month = 30 * 24 * 60 * 60_000;
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  let expired = 0;
  const release = scheduleRuntimeDeadline(start + month, () => expired++);
  t.mock.timers.tick(2_147_483_647);
  assert.equal(expired, 0, "the first timer chunk must not expire a month-long run");
  t.mock.timers.tick(month - 2_147_483_647 - 1);
  assert.equal(expired, 0);
  t.mock.timers.tick(1);
  assert.equal(expired, 1);
  t.mock.timers.tick(month);
  assert.equal(expired, 1);
  release();
});

test("Unlimited and released timers never expire; elapsed recovery deadlines do", t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_700_000_000_000 });
  let expired = 0;
  const unlimited = scheduleRuntimeDeadline(Infinity, () => expired++);
  const cancelled = scheduleRuntimeDeadline(Date.now() + 900_000, () => expired++);
  cancelled();
  t.mock.timers.tick(365 * 24 * 60 * 60_000);
  assert.equal(expired, 0);
  scheduleRuntimeDeadline(Date.now() - 1, () => expired++);
  t.mock.timers.tick(1);
  assert.equal(expired, 1);
  unlimited();
});
