import type { AskUserInput } from "../question-contract";
import type { GatewayTool } from "./gateway-core.mjs";
type Context = Record<string, unknown>;
type PlanInput = { title: string; plan: string[] | string; language?: string };
type ReportInput = { title: string; content: string };
export const RESEARCH_WORKFLOW_TOOLS: GatewayTool[];
export function researchPlanForm(args: PlanInput): AskUserInput;
export function createResearchWorkflow(input: {
  stateDir: string;
  ask?: (form: AskUserInput, context: Context, options: { signal?: AbortSignal }) => Promise<unknown>;
  attachReport?: (report: ReportInput, context: Context) => Promise<Record<string, unknown>>;
}): {
  assertAllowed(name: string, context: Context): Promise<void>;
  plan(args: PlanInput, context: Context, options?: { signal?: AbortSignal }): Promise<{ status: string; plan: string[]; next: string }>;
  report(args: ReportInput, context: Context): Promise<Record<string, unknown>>;
};
