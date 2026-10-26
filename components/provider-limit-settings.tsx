"use client";
import { ProviderRecoverySetting } from "@/components/provider-recovery-setting";

export function ProviderLimitSettings() {
  return <ProviderRecoverySetting endpoint="/api/agent-settings/provider-limit" id="provider-limit-resume"
    label="Wait for provider limits to reset"
    description="Automatically continue the same run when the provider reports its reset time. Enabled by default."
    applicability="Changes apply to newly reached limits. Use Stop to cancel a run already waiting." />;
}
