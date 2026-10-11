import { createClientId } from "@/lib/client-id";

const STORAGE_KEY = "metis-device-id";

export function getMetisDeviceId() {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (existing) return existing.slice(0, 120);
    const id = createClientId();
    window.sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return "";
  }
}
