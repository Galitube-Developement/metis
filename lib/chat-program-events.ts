export type HandoffState = "queued" | "running" | "completed" | "error" | "cancelled";
export type HandoffActivity = {
  id: string;
  sender: string;
  recipient: string;
  status: HandoffState;
  task: string;
  context?: string;
  result?: string;
  error?: string;
};
export type ChatProgramEvent =
  | { type: "handoff"; activity: HandoffActivity }
  | { type: "team-review"; status: string };

type ActivityMessage = { id: string; role: string; content: string; programEvent?: ChatProgramEvent };
export type ChatTranscriptItem<T> =
  | { kind: "message"; id: string; message: T }
  | { kind: "team-activity"; id: string; activities: HandoffActivity[] }
  | { kind: "team-review"; id: string; status: string };

/** Only deterministic program message IDs qualify; ordinary pasted logs stay ordinary messages. */
export function legacyHandoffActivity(message: ActivityMessage): HandoffActivity | undefined {
  if (message.role !== "assistant") return;
  const id = /^handoff:([\da-f-]{36}):(?:sent|result:(?:sender|recipient))$/i.exec(message.id)?.[1];
  if (!id) return;
  const [header, ...paragraphs] = message.content.split("\n\n");
  const pieces = header.split(" · ");
  if (pieces.length !== 3 || pieces[0] !== "Handoff " + id) return;
  const names = pieces[1].split(" → ");
  const status = pieces[2] as HandoffState;
  if (names.length !== 2 || !["queued", "running", "completed", "error", "cancelled"].includes(status)) return;
  const body = paragraphs.join("\n\n");
  if (!body.startsWith("Task: ")) return;
  const fields = body.slice(6).split(/\n\n(?=Context: |Result: |Error: )/);
  const activity: HandoffActivity = { id, sender: names[0], recipient: names[1], status, task: fields.shift() || "" };
  for (const field of fields) {
    if (field.startsWith("Context: ")) activity.context = field.slice(9);
    else if (field.startsWith("Result: ")) activity.result = field.slice(8);
    else if (field.startsWith("Error: ")) activity.error = field.slice(7);
  }
  return activity;
}

/** Handoff/job states can change without a new chat checkpoint. */
export function chatProgramEventsChanged(
  current: Array<{ id: string; programEvent?: ChatProgramEvent }>,
  incoming: Array<{ id: string; programEvent?: ChatProgramEvent }>,
): boolean {
  const byId = new Map(current.map(message => [message.id, message.programEvent]));
  return incoming.some(message => message.programEvent &&
    JSON.stringify(message.programEvent) !== JSON.stringify(byId.get(message.id)));
}

/** Project durable program messages into activity without changing the model's transcript. */
export function projectChatTranscript<T extends ActivityMessage>(messages: T[]): ChatTranscriptItem<T>[] {
  const candidates = messages.map(message => message.programEvent?.type === "handoff"
    ? message.programEvent.activity : legacyHandoffActivity(message));
  const latest = new Map<string, { index: number; activity: HandoffActivity }>();
  candidates.forEach((activity, index) => {
    if (!activity) return;
    const previous = latest.get(activity.id)?.activity;
    latest.set(activity.id, { index, activity: {
      ...activity,
      context: activity.context ?? previous?.context,
      result: activity.result ?? previous?.result,
      error: activity.error ?? previous?.error,
    } });
  });
  const items: ChatTranscriptItem<T>[] = [];
  messages.forEach((message, index) => {
    const activity = candidates[index];
    if (activity) {
      const entry = latest.get(activity.id)!;
      if (entry.index !== index) return;
      const previous = items.at(-1);
      if (previous?.kind === "team-activity") previous.activities.push(entry.activity);
      else items.push({ kind: "team-activity", id: message.id, activities: [entry.activity] });
    } else if (message.programEvent?.type === "team-review") {
      items.push({ kind: "team-review", id: message.id, status: message.programEvent.status });
    } else items.push({ kind: "message", id: message.id, message });
  });
  return items;
}
