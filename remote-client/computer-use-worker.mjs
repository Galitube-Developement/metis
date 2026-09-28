import { parentPort } from "node:worker_threads";
import { computerUse } from "./computer-use.mjs";

if (!parentPort) throw new Error("Computer Use worker requires a parent port");

const controllers = new Map();
let queue = Promise.resolve();

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : "Computer Use failed",
    stack: error instanceof Error ? error.stack : undefined,
  };
}

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "cancel") {
    controllers.get(message.id)?.abort();
    return;
  }
  if (message.type === "cancel-all") {
    for (const controller of controllers.values()) controller.abort();
    return;
  }
  if (message.type !== "run" || typeof message.id !== "string") return;

  const controller = new AbortController();
  controllers.set(message.id, controller);
  const run = async () => {
    if (controller.signal.aborted) throw new Error("Computer Use was cancelled");
    return computerUse(message.params || {}, { signal: controller.signal });
  };

  queue = queue.catch(() => {}).then(run);
  queue.then(
    (result) => parentPort.postMessage({ type: "result", id: message.id, result }),
    (error) => parentPort.postMessage({ type: "error", id: message.id, error: serializeError(error) }),
  ).finally(() => controllers.delete(message.id));
});
