import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

test("Computer Use runs behind the worker message boundary", async () => {
  const worker = new Worker(new URL("../remote-client/computer-use-worker.mjs", import.meta.url));
  try {
    const id = "worker-probe";
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Computer Use worker did not respond")), 5_000);
      worker.once("error", reject);
      worker.on("message", (message) => {
        if (message?.id !== id) return;
        clearTimeout(timeout);
        resolve(message);
      });
      worker.postMessage({ type: "run", id, params: { operation: "status" } });
    });
    assert.equal(response.id, id);
    assert.ok(response.type === "result" || response.type === "error");
    if (process.platform === "win32") assert.equal(response.type, "result");
    else assert.match(response.error?.message || "", /requires (?:a )?Windows/i);
  } finally {
    await worker.terminate();
  }
});
