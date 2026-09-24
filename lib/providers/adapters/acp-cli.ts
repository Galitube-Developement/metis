import type { ProviderContext } from "./provider-support";
import type { ProviderResult } from "./contract";
import { unsupported, type ProviderAdapterShape } from "./contract";
import { runAcpStdioAgent } from "@/lib/providers/acp-stdio";
import { managedCliExecutable } from "@/lib/providers/managed-cli";
import { getUserAgentCwd, getMcpServers } from "@/lib/mcp";
import {
  effectiveModelParams,
  providerConversationPrompt,
  providerMcpContext,
  providerPrompt,
} from "@/lib/providers/adapters/provider-support";

type AcpCliAdapterConfig = {
  readonly key: "grok-cli" | "opencode-cli";
  readonly binary: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

export const GROK_MCP_ONLY_ARGS = [
  "--tools",
  "",
  "--no-subagents",
  "--disable-web-search",
  "agent",
  "stdio",
] as const;

export const OPENCODE_MCP_ONLY_CONFIG = {
  tools: {
    read: false,
    write: false,
    edit: false,
    patch: false,
    apply_patch: false,
    glob: false,
    grep: false,
    list: false,
    bash: false,
    task: false,
    todowrite: false,
    todoread: false,
    webfetch: false,
    websearch: false,
    lsp: false,
    skill: false,
    question: false,
  },
} as const;

export const OPENCODE_MCP_ONLY_ENV = {
  OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_MCP_ONLY_CONFIG),
  OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
} as const;

function acpCliAdapter(config: AcpCliAdapterConfig): ProviderAdapterShape {
  const capabilities = {
    contextOwner: "metis",
    persistentThreads: false,
    interruptibleTurns: true,
    interactiveRequests: false,
    sessionModelSwitch: "unsupported",
    nativeSubagents: false,
    nativeContextTelemetry: false,
  } as const;
  return {
    key: config.key,
    capabilities,
    runTurn: async (context: ProviderContext): Promise<ProviderResult> => {
      const binary =
        typeof context.connection.config.binaryPath === "string" &&
        context.connection.config.binaryPath.trim()
          ? context.connection.config.binaryPath.trim()
          : managedCliExecutable(config.key === "grok-cli" ? "grok" : "opencode", config.binary);
      const result = await runAcpStdioAgent({
        command: binary,
        args: [...config.args],
        ...(config.env ? { env: { ...config.env } } : {}),
        cwd: getUserAgentCwd(context.job.userId),
        prompt: [
          providerPrompt(
            context.job,
            ["mcp"],
            true,
            effectiveModelParams(context.chat, context.job),
          ),
          providerConversationPrompt(context),
        ]
          .filter(Boolean)
          .join("\n\nUser request:\n"),
        mcp: getMcpServers(providerMcpContext(context)),
        signal: context.signal,
        clientName: "metis-ai",
        onText: context.onText,
        onTool: context.onTool,
      });
      return result.sessionId
        ? { agentId: `${config.binary}:${result.sessionId}` }
        : {};
    },
    startSession: () => unsupported("startSession", config.key),
    sendTurn: () => unsupported("sendTurn", config.key),
    interrupt: () => unsupported("interrupt", config.key),
    respondToRequest: () => unsupported("respondToRequest", config.key),
    respondToUserInput: () => unsupported("respondToUserInput", config.key),
    stopSession: () => unsupported("stopSession", config.key),
    readThread: () => unsupported("readThread", config.key),
    rollbackThread: () => unsupported("rollbackThread", config.key),
    streamEvents: () => unsupported("streamEvents", config.key),
  };
}

export const grokAdapter = acpCliAdapter({
  key: "grok-cli",
  binary: "grok",
  args: GROK_MCP_ONLY_ARGS,
});

export const opencodeAdapter = acpCliAdapter({
  key: "opencode-cli",
  binary: "opencode",
  args: ["acp", "--pure"],
  env: OPENCODE_MCP_ONLY_ENV,
});
