import type { UsageTotals } from "./account-types";
export type UsageCostMode = "estimated" | "reported" | "hidden";
export const usageCostLabel = (mode: UsageCostMode) => mode==="estimated" ? "Estimated API value" : "Reported cost";
export const usageCost = (value: UsageTotals, mode: UsageCostMode) => mode==="estimated" ? value.estimatedCostUsd??null : mode==="reported" ? value.costUsd : null;
export const usageCostReports = (value: UsageTotals, mode: UsageCostMode) => mode==="estimated" ? value.estimatedCostReports??0 : mode==="reported" ? value.costReports : 0;
