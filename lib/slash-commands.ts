export type SlashCommandId = "model" | "goal";

export const BUILT_IN_SLASH_COMMANDS: ReadonlyArray<{
  id: SlashCommandId;
  label: string;
  description: string;
}> = [
  { id: "model", label: "/model", description: "Choose a model" },
  { id: "goal", label: "/goal", description: "Send and keep a chat goal; /goal reset clears it" },
];

/** Slash commands are recognized only at the start of the composer. */
export function slashCommandQuery(input: string, cursorPosition: number): string | null {
  if (cursorPosition < 1 || input[0] !== "/") return null;
  const beforeCursor = input.slice(0, cursorPosition);
  const match = beforeCursor.match(/^\/([a-z-]*)$/i);
  return match ? match[1].toLowerCase() : null;
}

export function goalCommandAction(argument: string): { kind: "reset" } | { kind: "set"; goal: string } {
  const goal = argument.trim().slice(0, 4_000);
  return !goal || /^(?:reset|clear)$/i.test(goal) ? { kind: "reset" } : { kind: "set", goal };
}

export function matchSlashCommand(input: string): { id: SlashCommandId; argument: string } | null {
  const match = input.trim().match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = BUILT_IN_SLASH_COMMANDS.find((item) => item.id === match[1].toLowerCase());
  return command ? { id: command.id, argument: (match[2] || "").trim() } : null;
}
