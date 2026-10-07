import type { ChatRunStatus } from "@/lib/store";

export type ProjectMode = "chat" | "agents";

export type ProjectAgentStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting_input"
  | "completed"
  | "error"
  | "cancelled"
  | "archived";

export type ProjectAgent = {
  id: string;
  projectId: string;
  chatId: string;
  name: string;
  role: string;
  systemPrompt: string;
  color: string;
  modelId?: string;
  supervisorId?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectAgentStatus;
};

export type ProjectHandoffStatus =
  | "queued"
  | "running"
  | "completed"
  | "error"
  | "cancelled";

export type ProjectHandoff = {
  id: string;
  projectId: string;
  jobId?: string;
  rootJobId?: string;
  depth?: number;
  retryOf?: string;
  attempt?: number;
  deadlineAt?: string;
  reportedAt?: string;
  senderName?: string;
  recipientName?: string;
  senderAgentId?: string;
  recipientAgentId: string;
  parentHandoffId?: string;
  parentJobId?: string;
  task: string;
  context?: string;
  status: ProjectHandoffStatus;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export function normalizeProjectMode(value: unknown): ProjectMode {
  return value === "agents" ? "agents" : "chat";
}

export function deriveProjectAgentStatus(
  chatStatus: ChatRunStatus | undefined,
  archivedAt?: string,
): ProjectAgentStatus {
  if (archivedAt) return "archived";
  switch (chatStatus) {
    case "running": return "running";
    case "waiting_input":
    case "waiting_for_user": return "waiting_input";
    case "completed": return "completed";
    case "error": return "error";
    case "cancelled": return "cancelled";
    default: return "idle";
  }
}
