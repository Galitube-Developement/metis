import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeTaskList } from "./task-list.mjs";

const schema = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
export const RESEARCH_WORKFLOW_TOOLS = [
  { name: "research_plan", description: "Before researching, submit plan as a JSON array of individual step strings for user review, not Markdown or a JSON code block. Opens a blocking form with numbered steps that the user can edit, reorder, add or delete and an explicit Approve, Revise or Deny choice. Only a submitted approval unlocks research; use the returned edited plan. Denial/cancellation stops research. Does not create a Plan workspace.",
    inputSchema: { "x-metis-waits-for-user": true, ...schema({ title: { type: "string", minLength: 1, maxLength: 200 }, plan: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 4000 }, description: "Ordered research steps as JSON strings, up to 4000 characters total. Numbering is added by the UI." }, language: { type: "string", description: "User language code, e.g. de or en." } }, ["title", "plan"]) },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "research_report", description: "Finish approved research by creating and attaching the complete report as a Markdown file. Include findings, evidence, citations, limitations and sources. Returns the protected attachment and download Markdown. No arbitrary workspace file writes.",
    inputSchema: schema({ title: { type: "string", minLength: 1, maxLength: 200 }, content: { type: "string", minLength: 1, maxLength: 500000 } }, ["title", "content"]),
    annotations: { readOnlyHint: false, destructiveHint: false } },
];

// Older provider sessions may still send the previous Markdown tool argument.
function inputTasks(plan) {
  if (typeof plan === "string") {
    if (plan.length > 4000) throw new Error("Research steps may contain at most 4000 characters in total.");
    plan = plan.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, "").trim()).filter(Boolean);
  }
  return normalizeTaskList(plan);
}
export function researchPlanForm({ title, plan, language }) {
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw new Error("A research title up to 200 characters is required");
  const tasks = inputTasks(plan);
  const de = /^de(?:-|$)/i.test(language || "");
  return {
    language: de ? "de" : "en",
    title: de ? "Rechercheplan prüfen" : "Review research plan",
    description: title.trim(),
    submitLabel: de ? "Entscheidung senden" : "Submit decision",
    questions: [
      { key: "plan", type: "task_list", question: de ? "Rechercheschritte" : "Research steps", default: tasks, description: de ? "Über den Stift kannst du Schritte bearbeiten, ergänzen und neu anordnen." : "Use the pencil to edit, add and reorder steps.", required: true },
      { key: "decision", type: "radio", question: de ? "Entscheidung" : "Decision", required: true, options: [
        { label: de ? "Freigeben und recherchieren" : "Approve and research", value: "approve" },
        { label: de ? "Überarbeiten" : "Revise", value: "revise" },
        { label: de ? "Ablehnen" : "Deny", value: "deny" },
      ] },
    ],
  };
}

// Only the authenticated account/chat/run selects storage. Tool arguments cannot supply identity.
export function createResearchWorkflow({ stateDir, ask, attachReport }) {
  const privateStates = new Map();
  const pending = new Set();
  function identity(context) {
    if (!context.userId || !context.chatId || !context.jobId) throw new Error("Research workflow requires an authenticated chat run");
    return createHash("sha256").update(JSON.stringify([context.userId, context.chatId, context.jobId])).digest("hex");
  }
  const file = key => path.join(stateDir, "research-workflows", key + ".json");
  async function load(context) {
    const key = identity(context);
    if (context.incognito) {
      const state = privateStates.get(key);
      if (state?.expiresAt > Date.now()) return state.value;
      privateStates.delete(key);
      return undefined;
    }
    try { return JSON.parse(await fs.readFile(file(key), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  }
  async function save(context, state) {
    const key = identity(context);
    if (context.incognito) {
      for (const [id, item] of privateStates) if (item.expiresAt <= Date.now()) privateStates.delete(id);
      if (!privateStates.has(key) && privateStates.size >= 128) privateStates.delete(privateStates.keys().next().value);
      privateStates.set(key, { value: state, expiresAt: Date.now() + 86400000 });
      return;
    }
    await fs.mkdir(path.dirname(file(key)), { recursive: true, mode: 0o700 });
    const temp = file(key) + "." + randomUUID() + ".tmp";
    try { await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(temp, file(key)); }
    finally { await fs.rm(temp, { force: true }); }
  }
  async function approved(context) {
    const state = await load(context);
    if (state?.status !== "approved") throw new Error("Research is locked: call research_plan and wait for explicit user approval. A denial, revision, cancellation or missing answer is not approval.");
    return state;
  }
  return {
    async assertAllowed(name, context) {
      if (context.modeId !== "deep-research") return;
      // Setup, skill reads and clarification remain possible; evidence gathering waits.
      if (/^(research_(search|open|find|sources|report)|web_|browser_|context7_)/.test(name) || ["call_mcp_tool", "context_search", "search_notes", "list_notes", "list_memories", "search_chats"].includes(name)) await approved(context);
    },
    async plan(args, context, options = {}) {
      const form = researchPlanForm(args);
      const key = identity(context);
      if (pending.has(key)) throw new Error("A research plan is already awaiting a decision");
      pending.add(key);
      try {
        await save(context, { status: "awaiting_approval", title: args.title, plan: form.questions[0].default });
        const answer = await ask(form, context, options);
        // Typed form values from the user-answer endpoint only. Never accept args or default selections.
        const decision = answer?.questionId && answer.values?.decision;
        let plan = [];
        try { plan = typeof args.plan === "string" ? inputTasks(answer?.values?.plan) : normalizeTaskList(answer?.values?.plan); } catch { /* Invalid submissions never unlock research. */ }
        const status = decision === "approve" && plan.length ? "approved" : decision === "revise" ? "revision_requested" : "denied";
        const state = { status, title: args.title, plan, questionId: answer?.questionId, decidedAt: new Date().toISOString() };
        await save(context, state);
        return { ...state, next: status === "approved" ? "Research exactly the edited plan. Keep one task checklist; finish with research_report." : status === "revision_requested" ? "Revise this edited plan and submit it again. Do not research yet." : "Stop research. Do not resubmit unless the user asks." };
      } catch (error) { await save(context, { status: "cancelled" }); throw error; }
      finally { pending.delete(key); }
    },
    async report(args, context) {
      const state = await approved(context);
      if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 200 || typeof args.content !== "string" || !args.content.trim() || Buffer.byteLength(args.content, "utf8") > 500000) throw new Error("A report title and nonempty content up to 500000 bytes are required");
      const artifact = await attachReport({ title: args.title.trim(), content: args.content }, context);
      // A failed attachment must remain retryable; never claim a file exists before this succeeds.
      return { status: "report_attached", approvedPlan: state.plan, ...artifact };
    },
  };
}
