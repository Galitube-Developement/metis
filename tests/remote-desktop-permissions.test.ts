import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDesktopPermissionStatus, parseHelperPermissionOutput } from "../lib/remote-desktop-permissions.ts";

test("normalizes macOS desktop permission status", () => {
  const status = normalizeDesktopPermissionStatus({
    available: false,
    accessibility: false,
    screenRecording: false,
    reason: "Enable Screen Recording and Accessibility",
  });
  assert.equal(status.available, false);
  assert.equal(status.accessibility, false);
  assert.equal(status.screenRecording, false);
  assert.match(status.reason || "", /Screen Recording/);
});

test("parses helper JSON from execute_command stdout", () => {
  const status = parseHelperPermissionOutput('{"accessibility":true,"available":true,"reason":"","screenRecording":true}');
  assert.equal(status.available, true);
  assert.equal(status.accessibility, true);
  assert.equal(status.screenRecording, true);
});
