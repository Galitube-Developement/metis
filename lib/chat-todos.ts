import { classifyToolKind, todosFromToolPayload, unwrapToolRecord } from "@/lib/tool-call-display";

export type ChatTodo = { id?: string; content: string; status?: string };
type TodoTool = {
  id: string; name: string; status: string; kind?: string;
  input?: string; result?: string; todos?: ChatTodo[];
};
type TodoMessage = {
  id: string; role: string; createdAt?: string;
  tools?: TodoTool[]; parts?: Array<{ type: string } & Partial<TodoTool>>;
};
export type ChatTodoState = {
  messageId: string; toolId: string; createdAt: string; toolIndex: number; items: ChatTodo[];
};

/** Derive the current checklist from successful history, including explicit clears. */
export function currentChatTodos(messages: readonly TodoMessage[]): ChatTodoState | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const message = messages[m];
    if (message.role !== "assistant") continue;
    const tools = new Map<string, TodoTool>();
    for (const tool of message.tools || []) tools.set(tool.id, tool);
    for (const part of message.parts || []) {
      if (part.type === "tool" && part.id && part.name && part.status) {
        tools.set(part.id, { ...tools.get(part.id), ...part } as TodoTool);
      }
    }
    const ordered = [...tools.values()];
    for (let i = ordered.length - 1; i >= 0; i--) {
      const tool = ordered[i];
      if (!/^(completed|complete|success|succeeded|done)$/i.test(tool.status)) continue;
      // Do not parse large unrelated shell/read payloads.
      if (tool.kind !== "todo" && !tool.todos && classifyToolKind(tool.name, tool.input) !== "todo") continue;
      const result = unwrapToolRecord(tool.result);
      if (result?.isError === true || result?.error || result?.ok === false) continue;
      let items: ChatTodo[] | undefined;
      for (const raw of [tool.result, tool.input]) {
        if (!raw) continue;
        const record = unwrapToolRecord(raw);
        const list = record?.todos ?? record?.items ?? record?.tasks ?? record?.todoList;
        if (!Array.isArray(list)) continue;
        items = list.length === 0 ? [] : todosFromToolPayload(raw);
        if (items) break;
      }
      items ??= tool.todos;
      if (!items) continue;
      return { messageId: message.id, toolId: tool.id, createdAt: message.createdAt || "", toolIndex: i, items };
    }
  }
  return null;
}

export function newerChatTodos(local: ChatTodoState | null, saved: ChatTodoState | null): ChatTodoState | null {
  if (!local) return saved;
  if (!saved) return local;
  if (local.messageId === saved.messageId) return local.toolIndex >= saved.toolIndex ? local : saved;
  return local.createdAt >= saved.createdAt ? local : saved;
}
