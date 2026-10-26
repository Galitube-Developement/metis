"use client";
import { ProviderRecoverySetting } from "@/components/provider-recovery-setting";

export function ProviderRetrySettings() {
  return <ProviderRecoverySetting endpoint="/api/agent-settings/provider-retry" id="provider-error-retry"
    label="Automatically retry provider errors"
    description="Continue the same run after a transient provider error, with up to 3 retries. Disabled by default."
    applicability="Changes apply to the next provider error. Use Stop to cancel a run." />;
}
