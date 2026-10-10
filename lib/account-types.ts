export type ProfileLink = { label: string; url: string };
export type AccountProfile = {
  displayName: string; bio: string; avatar: string | null; links: ProfileLink[];
  shareId: string | null; shareActivity: boolean; handle: string | null;
};
export type UsageTotals = {
  requests: number; inputTokens: number; outputTokens: number; tokens: number;
  costUsd: number | null; tokenReports: number; costReports: number; inputReports: number; outputReports: number;
};
export type UsageDay = UsageTotals & { date: string };
export type UsageModel = UsageTotals & { modelId: string; providerId: string };
export type AccountUsage = {
  from: string; to: string; timezone: "UTC"; totals: UsageTotals; days: UsageDay[];
  models: UsageModel[];
};
