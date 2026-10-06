export const MICROPHONE_STORAGE_KEY = "metis.voice.microphone";

export function readLocalMicrophone(storage?: Pick<Storage, "getItem">): string {
  try {
    const local = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    return local?.getItem(MICROPHONE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveLocalMicrophone(deviceId: string, storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage) {
  if (deviceId) storage.setItem(MICROPHONE_STORAGE_KEY, deviceId);
  else storage.removeItem(MICROPHONE_STORAGE_KEY);
}

export function microphoneConstraints(deviceId: string): MediaStreamConstraints {
  return { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
}

export function microphoneInputs(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const seen = new Set<string>();
  return devices.filter(device => {
    if (device.kind !== "audioinput" || !device.deviceId || seen.has(device.deviceId)) return false;
    seen.add(device.deviceId);
    return true;
  });
}

export async function openSelectedMicrophone(
  mediaDevices: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices,
  deviceId = readLocalMicrophone(),
): Promise<MediaStream> {
  try {
    return await mediaDevices.getUserMedia(microphoneConstraints(deviceId));
  } catch (error) {
    if (deviceId && error instanceof Error && ["NotFoundError", "OverconstrainedError"].includes(error.name)) {
      throw new Error("The selected microphone is unavailable. Choose another microphone in Voice input settings.");
    }
    throw error;
  }
}
