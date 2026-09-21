export const clientConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Metis AI",
  username: process.env.NEXT_PUBLIC_CHAT_USERNAME?.trim() || "",
  defaultCwd: process.env.NEXT_PUBLIC_AGENT_CWD?.trim() || "workspace",
  storagePrefix: process.env.NEXT_PUBLIC_STORAGE_PREFIX?.trim() || "metis-ai",
} as const;
