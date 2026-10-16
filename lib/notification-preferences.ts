export type NotificationPrefs = {
  toastEnabled: boolean;
  /** Kept in the wire format for older clients; OS alerts now use Remote Clients. */
  browserEnabled: boolean;
  remoteEnabled: boolean;
  agentFinishedEnabled: boolean;
  remoteClientIds: string[];
};

export function normalizeNotificationPrefs(value: unknown): NotificationPrefs {
  const data = value && typeof value === "object" ? value as Partial<NotificationPrefs> : {};
  const remoteClientIds = Array.isArray(data.remoteClientIds)
    ? [...new Set(data.remoteClientIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0,50) : [];
  return {
    toastEnabled: typeof data.toastEnabled === "boolean" ? data.toastEnabled : true,
    browserEnabled: false,
    remoteEnabled: typeof data.remoteEnabled === "boolean" ? data.remoteEnabled : remoteClientIds.length > 0,
    agentFinishedEnabled: typeof data.agentFinishedEnabled === "boolean" ? data.agentFinishedEnabled : true,
    remoteClientIds,
  };
}

export function remoteNotificationAllowed(prefs: NotificationPrefs, agentFinished = false, clientId?: string) {
  return prefs.remoteEnabled && (!agentFinished || prefs.agentFinishedEnabled)
    && (clientId === undefined || prefs.remoteClientIds.includes(clientId));
}
