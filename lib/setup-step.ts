export type SetupStep = "welcome" | "people" | "provider" | "ready";

const SETUP_STEPS = new Set<SetupStep>(["welcome", "people", "provider", "ready"]);

export function resolveSetupStep(hasUsers: boolean, savedStep: string | null | undefined): SetupStep {
  const step = savedStep && SETUP_STEPS.has(savedStep as SetupStep) ? savedStep as SetupStep : null;
  if (!hasUsers) return step === "people" ? "people" : "welcome";
  return step && step !== "welcome" ? step : "people";
}
