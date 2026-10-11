import assert from "node:assert/strict";
import test from "node:test";
import { toast } from "sonner";
import { createErrorNotifier } from "../lib/client-error-notifications";

function setup() {
  let time = 100_000;
  const delivered: Array<{ title: string; description: string }> = [];
  const notify = createErrorNotifier((title, options) => delivered.push({ title, description: options.description }), () => time);
  return { notify, delivered, advance: (ms: number) => { time += ms; } };
}

test("errors have a readable toast without exposing the stack", () => {
  const { notify, delivered } = setup();
  const error = new Error("Provider is unavailable");
  error.stack = "private stack";
  assert.equal(notify(error, { title: "Run failed" }), true);
  assert.deepEqual(delivered, [{ title: "Run failed", description: "Provider is unavailable" }]);
  notify({ arbitrary: "payload" });
  assert.equal(delivered[1].description, "An unexpected error occurred. Please try again.");
});

test("normal cancellation does not show an error", () => {
  const { notify, delivered } = setup();
  assert.equal(notify(new DOMException("Cancelled", "AbortError")), false);
  assert.equal(notify({ name: "AbortError" }), false);
  assert.equal(delivered.length, 0);
});

test("repeated browser errors are deduped but can notify again later", () => {
  const { notify, delivered, advance } = setup();
  notify(new Error("Failed to fetch"));
  advance(100);
  assert.equal(notify("Failed to fetch"), false);
  advance(10_000);
  assert.equal(notify("Failed to fetch"), true);
  assert.equal(delivered.length, 2);
});

test("notification feed does not duplicate a live run failure or replace its detail", () => {
  const { notify, delivered, advance } = setup();
  notify("Provider rejected the request", { title: "Run failed", key: "run-error:chat-a" });
  advance(30_000);
  assert.equal(notify("Open the chat for details.", { title: "Run failed", key: "run-error:chat-a", occurredAt: 99_999 }), false);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].description, "Provider rejected the request");
});

test("another chat or a newer failure can notify immediately", () => {
  const { notify, delivered, advance } = setup();
  notify("Failed", { key: "run-error:chat-a" });
  assert.equal(notify("Failed", { key: "run-error:chat-b" }), true);
  advance(1000);
  assert.equal(notify("Failed", { key: "run-error:chat-a", occurredAt: 101_000 }), true);
  assert.equal(delivered.length, 3);
});

test("global browser exceptions and rejections produce toasts and remain logged", async () => {
  const telemetry = await import("../lib/client-telemetry");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalToast = toast.error;
  const originalConsole = console.error;
  const target = Object.assign(new EventTarget(), { navigator: { userAgent: "test" }, location: { href: "http://example.test", pathname: "/" } });
  const shown: unknown[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  toast.error = ((...args: unknown[]) => { shown.push(args); return "test"; }) as typeof toast.error;
  try {
    telemetry.installGlobalClientTelemetry();
    const exception = Object.assign(new Event("error"), { message: "Browser exception marker", error: new Error("Browser exception marker") });
    target.dispatchEvent(exception);
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("Rejected action marker") }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new DOMException("Cancelled", "AbortError") }));
    assert.equal(shown.length, 2);
    assert.ok(telemetry.__queuedClientTelemetryForTests().some(e => e.message === "Browser exception marker"));
    assert.ok(telemetry.__queuedClientTelemetryForTests().some(e => e.message === "Rejected action marker"));
  } finally {
    telemetry.__resetClientTelemetryForTests();
    toast.error = originalToast;
    console.error = originalConsole;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
