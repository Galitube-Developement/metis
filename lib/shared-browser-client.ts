import { config } from "@/lib/config";
import { getGlobalModelSettings } from "@/lib/db-store";
import { featureFlags } from "@/lib/feature-flags";

export type SharedBrowserAction = {
  action: string;
  tabId?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  value?: string;
  targetSelector?: string;
  filePath?: string;
  exact?: boolean;
  timeoutMs?: number;
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
  steps?: SharedBrowserAction[];
  frame?: string;
  source?: "agent" | "user";
  x?: number;
  y?: number;
  deltaY?: number;
  width?: number;
  height?: number;
};

export type SharedBrowserResult = {
  sessionId: string;
  tabId: string;
  activeTabId: string;
  url: string;
  title: string;
  tabs: Array<{ id: string; url: string; title: string }>;
  screenshot?: string;
  snapshot?: string;
  viewport: { width: number; height: number };
  form?: { text: string; controls: Array<Record<string, unknown>> };
  batch?: Array<{ index: number; action: string; ok: boolean; error?: string }>;
};

export async function performSharedBrowserAction(
  userId: string,
  chatId: string,
  action: SharedBrowserAction,
) {
  if (!featureFlags(getGlobalModelSettings(userId)).browser) {
    throw new Error(
      "The Metis workspace browser is disabled in Preferences. Enable Browser to use browser_* tools; shell/curl/Playwright are not used as a fallback.",
    );
  }
  const configuredToken =
    process.env.AI_CHAT_INTERNAL_TOKEN?.trim() ||
    process.env.MCP_BEARER_TOKEN?.trim();
  if (!configuredToken) throw new Error("An internal browser bearer token is required");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-AI-Chat-Internal": "1",
    "X-AI-Chat-Id": chatId,
    "X-AI-Chat-User-Id": userId,
  };
  headers.Authorization = `Bearer ${configuredToken}`;

  let response: Response;
  try {
    response = await fetch(
      `http://127.0.0.1:${config.port}/__internal/browser-engine`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(action),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "Browser action timed out"
        : "Browser engine is unreachable",
    );
  }
  const data = (await response.json().catch(() => ({}))) as
    | SharedBrowserResult
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in data && data.error
        ? data.error
        : `Browser action failed (${response.status})`,
    );
  }
  return data as SharedBrowserResult;
}
