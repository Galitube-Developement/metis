export type DesktopPermissionStatus = {
  available: boolean;
  accessibility?: boolean;
  screenRecording?: boolean;
  monitors?: number;
  backend?: string;
  reason?: string;
};

export function normalizeDesktopPermissionStatus(raw: unknown): DesktopPermissionStatus {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const monitors = Number(data.monitors);
  return {
    available: data.available === true,
    ...(typeof data.accessibility === "boolean" ? { accessibility: data.accessibility } : {}),
    ...(typeof data.screenRecording === "boolean" ? { screenRecording: data.screenRecording } : {}),
    ...(Number.isFinite(monitors) && monitors > 0 ? { monitors } : {}),
    ...(typeof data.backend === "string" && data.backend.trim() ? { backend: data.backend.trim() } : {}),
    ...(typeof data.reason === "string" && data.reason.trim() ? { reason: data.reason.trim() } : {}),
  };
}

export function parseHelperPermissionOutput(stdout: unknown): DesktopPermissionStatus {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("Desktop helper returned no permission status");
  return normalizeDesktopPermissionStatus(JSON.parse(text));
}
