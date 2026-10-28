import { getMcpServers, getUserAgentCwd } from "@/lib/mcp";
import { providerModelsForConnection } from "@/lib/providers/discovery";
import { sanitizeModelParams } from "@/lib/model-params";
import {
  antigravitySessionDir,
  antigravitySupportsEffort,
  runAntigravitySdkJob,
  runOfficialAntigravityJob,
} from "@/lib/providers/official-antigravity";
import {
  getProviderSessionBinding,
  updateProviderSessionBinding,
} from "@/lib/providers/session-bindings";
import {
  effectiveModelParams,
  nativeRecoveryPrompt,
  providerCurrentTurnPrompt,
  providerMcpContext,
  providerPrompt,
  type ProviderContext,
} from "./provider-support";
import {
  unsupported,
  type ProviderAdapterShape,
  type ProviderResult,
} from "./contract";

async function runAntigravity(
  context: ProviderContext,
): Promise<ProviderResult> {
  if (!context.job.userId) throw new Error("Antigravity requires a user id.");
  const modelId = context.modelId;
  const model = providerModelsForConnection(context.connection).find(model=>model.id===modelId);
  const contract = {parameters:model?.parameters?.map(parameter=>({...parameter,values:[...parameter.values]})) || []};
  const params = sanitizeModelParams(contract,effectiveModelParams(context.chat,context.job));
  const effortValue = params.find(param=>param.id==="effort")?.value;
  const supportsEffort = antigravitySupportsEffort(contract);
  const binding = getProviderSessionBinding(
    context.chat,
    "antigravity-cli",
    context.connection.id,
  );
  const previousId = binding?.lastKnownGoodCursor;
  const currentPrompt = previousId
    ? providerCurrentTurnPrompt(context)
    : nativeRecoveryPrompt(context);
  const prompt = [
    providerPrompt(
      context.job,
      ["mcp"],
      true,
      effectiveModelParams(context.chat, context.job),
      "antigravity-cli",
    ),
    currentPrompt,
  ]
    .filter(Boolean)
    .join("\n\nUser request:\n");
  const mcp = getMcpServers(
    providerMcpContext(context),
  );
  const cwd = getUserAgentCwd(context.job.userId);
  const extraEnv =
    context.connection.authType === "oauth"
      ? undefined
      : Object.fromEntries(
          Object.entries({
            ...(context.connection.secret
              ? { GEMINI_API_KEY: context.connection.secret }
              : {}),
            ...(context.connection.authType === "vertex_adc"
              ? {
                  GOOGLE_GENAI_USE_VERTEXAI: "true",
                  ...(typeof context.connection.config.project === "string"
                    ? { GOOGLE_CLOUD_PROJECT: context.connection.config.project }
                    : {}),
                  ...(typeof context.connection.config.location === "string"
                    ? { GOOGLE_CLOUD_LOCATION: context.connection.config.location }
                    : {}),
                }
              : {}),
          }).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );

  if (context.connection.authType === "oauth") {
    const result = await runOfficialAntigravityJob({
      userId: context.job.userId,
      connectionId: context.connection.id,
      chatId: context.chat.id,
      secret: context.connection.secret || "",
      modelId,
      conversationId: previousId,
      ...(supportsEffort && effortValue
        ? { effort: effortValue }
        : {}),
      prompt,
      cwd,
      mcp,
      extraEnv,
      signal: context.signal,
      onText: context.onText,
      onStream: context.onStream,
      onTool: context.onTool,
    });
    if (result.conversationId) {
      updateProviderSessionBinding({
        chatId: context.chat.id,
        ownerId: context.job.userId,
        execution: "antigravity-cli",
        connectionId: context.connection.id,
        contextOwner: "native",
        candidateCursor: result.conversationId,
        promoteCursor: true,
        modelId,
        ...(result.usage?.inputTokens !== undefined ? { lastContextTokens: result.usage.inputTokens } : {}),
      });
    }
    return {
      agentId: result.conversationId ? `antigravity:${result.conversationId}` : undefined,
      usage: result.usage,
    };
  }

  const sessionDir = antigravitySessionDir({
    userId: context.job.userId,
    connectionId: context.connection.id,
    chatId: context.chat.id,
  });
  const result = await runAntigravitySdkJob({
    modelId,
    prompt,
    cwd,
    mcp,
    extraEnv,
    apiKey: context.connection.secret || "",
    conversationId: previousId,
    sessionDir,
    signal: context.signal,
    onText: context.onText,
    onStream: context.onStream,
    onTool: context.onTool,
  });
  if (result.conversationId) {
    updateProviderSessionBinding({
      chatId: context.chat.id,
      ownerId: context.job.userId,
      execution: "antigravity-cli",
      connectionId: context.connection.id,
      contextOwner: "native",
      candidateCursor: result.conversationId,
      promoteCursor: true,
      modelId,
    });
  }
  return {
    agentId: result.conversationId
      ? `antigravity:${result.conversationId}`
      : undefined,
    usage: result.usage,
  };
}

export const antigravityAdapter: ProviderAdapterShape = {
  key: "antigravity-cli",
  capabilities: {
    contextOwner: "native",
    persistentThreads: true,
    interruptibleTurns: true,
    interactiveRequests: false,
    sessionModelSwitch: "restart-resume",
    nativeSubagents: true,
    nativeContextTelemetry: true,
  },
  startSession: () => unsupported("startSession", "antigravity-cli"),
  sendTurn: () => unsupported("sendTurn", "antigravity-cli"),
  interrupt: () => unsupported("interrupt", "antigravity-cli"),
  respondToRequest: () => unsupported("respondToRequest", "antigravity-cli"),
  respondToUserInput: () => unsupported("respondToUserInput", "antigravity-cli"),
  stopSession: async () => {},
  readThread: () => unsupported("readThread", "antigravity-cli"),
  rollbackThread: () => unsupported("rollbackThread", "antigravity-cli"),
  // eslint-disable-next-line require-yield -- ready-signal only; no turn history to replay while the facade owns the listener
  async *streamEvents(context) {
    context.onStream({
      type: "runtime.stream.ready",
      provider: "antigravity-cli",
    });
  },
  runTurn: runAntigravity,
};
