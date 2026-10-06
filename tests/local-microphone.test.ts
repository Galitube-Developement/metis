import assert from "node:assert/strict";
import test from "node:test";
import { MICROPHONE_STORAGE_KEY, readLocalMicrophone, saveLocalMicrophone, microphoneConstraints, microphoneInputs, openSelectedMicrophone } from "../lib/local-microphone";

function localStore() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("microphone selection persists locally and another device keeps its own selection", () => {
  const first = localStore();
  const second = localStore();
  saveLocalMicrophone("usb-microphone", first);
  assert.equal(readLocalMicrophone(first), "usb-microphone");
  assert.equal(readLocalMicrophone(second), "");
  assert.equal(first.getItem(MICROPHONE_STORAGE_KEY), "usb-microphone");
  saveLocalMicrophone("", first);
  assert.equal(readLocalMicrophone(first), "");
});

test("default input remains usable when local storage is blocked", () => {
  assert.equal(readLocalMicrophone({ getItem() { throw new Error("blocked"); } }), "");
  assert.throws(() => saveLocalMicrophone("mic", { setItem() { throw new Error("blocked"); }, removeItem() {} }), /blocked/);
  assert.deepEqual(microphoneConstraints(""), { audio: true });
});

test("recording acquires exactly the selected microphone", async () => {
  let constraints: MediaStreamConstraints | undefined;
  const stream = {} as MediaStream;
  const devices = { getUserMedia: async (value: MediaStreamConstraints) => { constraints = value; return stream; } };
  assert.equal(await openSelectedMicrophone(devices, "usb-mic"), stream);
  assert.deepEqual(constraints, { audio: { deviceId: { exact: "usb-mic" } } });
  await openSelectedMicrophone(devices, "");
  assert.deepEqual(constraints, { audio: true });
});

test("unplugged selected input fails clearly without recording a different microphone", async () => {
  let calls = 0;
  const devices = { getUserMedia: async () => { calls++; throw new DOMException("unplugged", "NotFoundError"); } };
  await assert.rejects(openSelectedMicrophone(devices, "missing"), /selected microphone is unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(openSelectedMicrophone({ getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); } }, "mic"), { name: "NotAllowedError" });
});

test("device picker includes audio inputs only and omits duplicate device IDs", () => {
  const device = (kind: MediaDeviceKind, deviceId: string) => ({ kind, deviceId } as MediaDeviceInfo);
  assert.deepEqual(microphoneInputs([device("audioinput", "usb"), device("videoinput", "cam"), device("audiooutput", "speaker"), device("audioinput", "usb"), device("audioinput", "default"), device("audioinput", "")]).map(input => input.deviceId), ["usb", "default"]);
});
