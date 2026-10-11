import type { RemoteClient } from "@/lib/remote-clients";

export function desktopUnavailableReason(client: RemoteClient): string | null {
  if (client.status !== "online") return client.status === "revoked" ? "This device has been revoked." : "This device is offline. Start its Remote Client to view the desktop.";
  if (!client.capabilities.includes("desktop_gui")) return "No interactive desktop is available on this device.";
  if (!client.policy.permissions.includes("computer_use")) return "Desktop access is disabled for this device. Enable Computer Use in Remote Devices.";
  return null;
}

export function chooseDesktopClient(clients: RemoteClient[], selectedId: string | null, agentId?: string | null) {
  return clients.find(client => client.id === agentId)
    ?? clients.find(client => client.id === selectedId)
    ?? clients.find(client => desktopUnavailableReason(client) === null)
    ?? clients[0] ?? null;
}
