import { EventEmitter } from "node:events";
export type RemoteDesktopEvent = {
  ownerId: string; chatId: string; clientId: string; action: string;
  phase: "start" | "end"; timestamp: number;
};
const globals = globalThis as typeof globalThis & { __metisDesktopEvents?: EventEmitter };
export const remoteDesktopEvents = globals.__metisDesktopEvents ??= new EventEmitter();
remoteDesktopEvents.setMaxListeners(0);
export function matchesDesktopEvent(event: RemoteDesktopEvent, ownerId: string, chatId: string) {
  return event.ownerId === ownerId && event.chatId === chatId;
}
