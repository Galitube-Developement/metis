import assert from "node:assert/strict";
import test from "node:test";
import { countStartingJobs, readWorkerMemoryState, workerMemoryAdmission, type WorkerMemoryState } from "../lib/worker-memory";
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const state = (changes: Partial<WorkerMemoryState> = {}): WorkerMemoryState => ({
  totalBytes: 32 * GiB, availableBytes: 20 * GiB,
  constraints: [{ limitBytes: 6 * GiB, usedBytes: .5 * GiB }], ...changes,
});

test("memory reservations stop a burst of 25 jobs before RSS has caught up", () => {
  const snapshot = state();
  let started = 0;
  while (started < 25 && workerMemoryAdmission(snapshot, started).additionalJobs > 0) started++;
  assert.equal(started, 4);
  assert.ok(started * GiB < snapshot.constraints[0].limitBytes);
  assert.equal(workerMemoryAdmission(snapshot, started).additionalJobs, 0);
});

test("new work waits under host pressure and resumes when memory becomes available", () => {
  assert.equal(workerMemoryAdmission(state({ availableBytes: 3 * GiB }), 2).additionalJobs, 0);
  assert.ok(workerMemoryAdmission(state(), 2).additionalJobs > 0);
});

test("worker and ancestor cgroup headroom constrain admission even on a mostly free host", () => {
  assert.equal(workerMemoryAdmission(state({ constraints: [
    { limitBytes: 8 * GiB, usedBytes: GiB },
    { limitBytes: 10 * GiB, usedBytes: 9 * GiB },
  ] }), 1).additionalJobs, 0);
  assert.equal(workerMemoryAdmission(state({ constraints: [{ limitBytes: 6 * GiB, usedBytes: 5.5 * GiB }] }), 1).additionalJobs, 0);
});

test("growing existing agents cannot make additional jobs start", () => {
  const a = workerMemoryAdmission(state({ constraints: [{ limitBytes: 6 * GiB, usedBytes: GiB }] }), 2);
  const b = workerMemoryAdmission(state({ constraints: [{ limitBytes: 6 * GiB, usedBytes: 5 * GiB }] }), 2);
  assert.ok(a.additionalJobs > b.additionalJobs);
  assert.equal(b.additionalJobs, 0);
});

test("small and non-systemd installations retain capacity for a first job", () => {
  const small = state({ totalBytes: GiB, availableBytes: .75 * GiB, constraints: [] });
  assert.ok(workerMemoryAdmission(small, 0).additionalJobs > 0);
  assert.equal(workerMemoryAdmission(small, 0).perJobBytes, 256 * MiB);
  assert.ok(workerMemoryAdmission(state({ constraints: [] }), 0).additionalJobs > 0);
});

test("explicit reservations and malformed settings are bounded", () => {
  assert.equal(workerMemoryAdmission(state(), 0, "512").perJobBytes, 512 * MiB);
  assert.equal(workerMemoryAdmission(state(), 0, "1").perJobBytes, 64 * MiB);
  for (const value of ["", "0", "-1", "Infinity", "bad"]) {
    assert.equal(workerMemoryAdmission(state(), 0, value).perJobBytes, GiB);
  }
});

test("finished jobs release reservations without cancelling any running job", () => {
  assert.equal(workerMemoryAdmission(state(), 4).additionalJobs, 0);
  assert.ok(workerMemoryAdmission(state(), 3).additionalJobs > 0);
});

test("startup reservations expire so waiting parents leave headroom for child agents", () => {
  assert.equal(countStartingJobs([0, 10_000, 20_000], 35_000), 2);
  assert.equal(countStartingJobs([0, 10_000, 20_000], 60_000), 0);
  const parents = state({ constraints: [{ limitBytes: 6 * GiB, usedBytes: 2 * GiB }] });
  assert.ok(workerMemoryAdmission(parents, 0).additionalJobs > 0);
});

test("real memory reader returns finite host values and applicable cgroup limits", async () => {
  const snapshot = await readWorkerMemoryState();
  assert.ok(snapshot.totalBytes > 0 && Number.isFinite(snapshot.totalBytes));
  assert.ok(snapshot.availableBytes >= 0 && Number.isFinite(snapshot.availableBytes));
  for (const constraint of snapshot.constraints) {
    assert.ok(constraint.limitBytes > 0 && Number.isFinite(constraint.limitBytes));
    assert.ok(constraint.usedBytes >= 0 && Number.isFinite(constraint.usedBytes));
  }
});
