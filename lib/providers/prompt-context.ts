     1	import { getChat, getGlobalModelSettings } from "@/lib/db-store";
     2	import { projectContextBlock } from "@/lib/projects";
     3	import {
     4	  globalFactsForScope,
     5	  loadContextScope,
     6	  resolveScopeReferences,
     7	} from "@/lib/context-scope";
     8	import { alwaysOnSkillsPrompt, projectSkillSettings, skillsCatalogPrompt } from "@/lib/skills";
     9	import { autoSkillActivationPrompt } from "@/lib/skill-routing";
    10	import { METIS_SHARED_AGENT_CONTROL, toolContractPrompt } from "@/lib/agent-control";
    11	import { metisAgentIdentity } from "@/lib/agent-identity";
    12	import { formatChatGoal } from "@/lib/chat-goal";
    13	import { modeById } from "@/lib/modes";
    14	import { retrieveRelevantFacts } from "@/lib/context-layers";
    15	import { buildAttachmentPrompt } from "@/lib/uploads";
    16	import type { AgentJob } from "@/lib/jobs";
    17	
    18	export type ProviderPromptContext = {
    19	  job: AgentJob;
    20	  toolNames?: ReadonlyArray<string>;
    21	  nativeTools?: boolean;
    22	  provider?: string;
    23	};
    24	
    25	const EXPLICIT_CONTEXT_CHARS = 80_000;
    26	const PINNED_CONTEXT_CHARS = 32_000;
    27	const CHAT_FACT_CHARS = 10_000;
    28	const GLOBAL_CONTEXT_CHARS = 10_000;
    29	
    30	function boundedJoin(blocks: string[], maxChars: number) {
    31	  let used = 0;
    32	  const selected: string[] = [];
    33	  for (const block of blocks) {
    34	    const trimmed = block.trim();
    35	    if (!trimmed) continue;
    36	    const remaining = maxChars - used;
    37	    if (remaining <= 0) break;
    38	    const next = trimmed.length > remaining ? `${trimmed.slice(0, Math.max(0, remaining - 32))}\n[context clipped]` : trimmed;
    39	    selected.push(next);
    40	    used += next.length + 2;
    41	  }
    42	  return selected.join("\n\n");
    43	}
    44	
    45	function referenceBlock(reference: NonNullable<AgentJob["references"]>[number]) {
    46	  return [
    47	    `- [${reference.kind}] ${reference.label}`,
    48	    reference.detail ? `  Detail: ${reference.detail}` : "",
    49	    reference.path ? `  Path/URL: ${reference.path}` : "",
    50	    reference.content ? `  Context:\n${reference.content}` : "",
    51	  ].filter(Boolean).join("\n");
    52	}
    53	
    54	function factBlock(title: string, facts: ReadonlyArray<{ id: string; content: string }>, maxChars: number) {
    55	  if (!facts.length) return "";
    56	  const body = boundedJoin(
    57	    facts.map((fact) => `- ${fact.id}: ${fact.content}`),
    58	    maxChars,
    59	  );
    60	  return body ? `${title}:\n${body}` : "";
    61	}
    62	
    63	/**
    64	 * Provider-neutral scoped instructions/context. This deliberately excludes the
    65	 * persisted conversation transcript. Native runtimes combine it with their own
    66	 * session; the custom harness combines it with Metis-managed messages.
    67	 *
    68	 * Context is layered: stable core + current task references + tool-driven repo map +
    69	 * retrieved durable context + bounded chat working memory. Checkpoints/history are
    70	 * owned by recovery/compaction and provider-native sessions, not replayed here.
    71	 */
    72	export function buildProviderPrompt(input: ProviderPromptContext): string {
    73	  const job = input.job;
    74	  const chat = getChat(job.chatId, job.userId);
    75	  if (!chat) return metisAgentIdentity();
    76	  const ownerId = job.userId ?? chat.ownerId;
    77	  const incognito = Boolean(job.incognito || chat.incognito);
    78	
    79	  const rawReferences = (job.references || []).map((reference) => ({
    80	    ...reference,
    81	    source: "explicit" as const,
    82	  }));
    83	  const resolvedReferences = resolveScopeReferences(ownerId, chat.id, rawReferences, incognito);
    84	  const scope = loadContextScope({
    85	    chatId: chat.id,
    86	    ownerId,
    87	    references: resolvedReferences,
    88	    includeGlobal: !incognito,
    89	  });
    90	  const project = !incognito ? scope?.project : undefined;
    91	  const globalSettings = getGlobalModelSettings(ownerId);
    92	  const skillSettings = projectSkillSettings(globalSettings, project);
    93	  const activeMode = modeById(job.modeId || chat.sessionState?.modeId, globalSettings.customModes || []);
    94	  const globalFacts = incognito
    95	    ? []
    96	    : globalFactsForScope({
    97	        chatId: chat.id,
    98	        ownerId,
    99	        includeGlobal: project?.memoryMode !== "project_only",
   100	      });
   101	
   102	  const explicit = boundedJoin([
   103	    ...resolvedReferences.map(referenceBlock),
   104	    job.referenceText ? `Referenced context:\n${job.referenceText}` : "",
   105	    buildAttachmentPrompt(job.chatId, job.attachments, ownerId),
   106	  ], EXPLICIT_CONTEXT_CHARS);
   107	
   108	  const pinned = boundedJoin([
   109	    ...(scope?.pinnedNotes || []).map((note) =>
   110	      `- [note] ${note.title || "Untitled note"}\n  Context:\n${note.content}`,
   111	    ),
   112	  ], PINNED_CONTEXT_CHARS);
   113	
   114	  const retrievalQuery = [
   115	    job.message,
   116	    job.referenceText,
   117	    ...resolvedReferences.flatMap((reference) => [reference.label, reference.detail, reference.path]),
   118	    project?.name,
   119	  ].filter((value): value is string => Boolean(value?.trim())).join("\n");
   120	
   121	  // T3-style context ownership: the active native provider session owns raw
   122	  // history and compaction. Metis layers only the durable slices needed now.
   123	  // Both chat and global durable memory are relevance-only. Native sessions
   124	  // already own vague follow-ups; stateless providers retain bounded history.
   125	  // A recent-fact fallback would inject unrelated short-term state.
   126	  const workingFacts = retrieveRelevantFacts(retrievalQuery, scope?.learnedFacts || [], {
   127	    limit: 8,
   128	    fallback: 0,
   129	  });
   130	  const retrievedGlobalFacts = retrieveRelevantFacts(retrievalQuery, globalFacts, {
   131	    limit: 8,
   132	    fallback: 0,
   133	  });
   134	
   135	  const workingBlock = factBlock("Chat working memory", workingFacts, CHAT_FACT_CHARS);
   136	  const projectBlock = project ? projectContextBlock(project, ownerId) : "";
   137	  const globalBlock = factBlock("Retrieved global durable memory", retrievedGlobalFacts, GLOBAL_CONTEXT_CHARS);
   138	
   139	  return [
   140	    // Layer 1 — Core Context: stable identity, policy, mode and tool contract.
   141	    metisAgentIdentity(),
   142	    `Current agent mode: ${activeMode.name}\n${activeMode.instructions}`,
   143	    formatChatGoal(chat.sessionState, ownerId, chat.id, incognito),
   144	    skillsCatalogPrompt(skillSettings),
   145	    alwaysOnSkillsPrompt(skillSettings),
   146	    autoSkillActivationPrompt(job.message, skillSettings, {
   147	      hasVisualReference: Boolean(job.attachments?.some((attachment) => attachment.kind === "image")),
   148	    }),
   149	    "Working style: precise, technically fluent, proactive. Act with tools instead of narrating steps. Reply in the user's language. On clear orders decide and act; ask only when genuinely ambiguous or destructive.",
   150	    "Execution efficiency: batch related read-only inspection instead of issuing many tiny calls; reuse the known project/repository cwd instead of rediscovering it; run targeted checks while iterating and the expensive full test/build pass only once after the working tree has stopped changing. Parallelize independent lightweight reads when safe, but do not run competing heavyweight builds. Keep progress narration to short milestone updates rather than one message per tool call.",
   151	    !incognito && globalSettings.responseInstructions?.trim()
   152	      ? `User response instructions (apply when relevant):\n${globalSettings.responseInstructions.trim().slice(0, 20_000)}`
   153	      : "",
   154	    METIS_SHARED_AGENT_CONTROL,
   155	    toolContractPrompt({
   156	      modeId: job.modeId || chat.sessionState?.modeId || "agent",
   157	      provider: input.provider || "alternative-provider",
   158	      toolNames: input.toolNames,
   159	      nativeTools: Boolean(input.nativeTools),
   160	    }),
   161	    // Layer 2 — Task State lives in the provider's current user turn. Do not
   162	    // duplicate job.message here. Explicit references are the only addendum.
   163	    explicit ? `Task context — explicit references:\n${explicit}` : "",
   164	    // Layer 3 — Repo Map is metadata/tool-driven, never a repository dump.
   165	    "Repository map: the filesystem/repository is durable external memory. Search/index first, then read only relevant files and symbols; never replay a whole repository into model context.",
   166	    // Layers 4/5 — Retrieved Context + Working Memory.
   167	    pinned ? `Pinned chat context:\n${pinned}` : "",
   168	    projectBlock ? `Project context:\n${projectBlock}` : "",
   169	    workingBlock,
   170	    globalBlock,
   171	    // Layer 6 — Checkpoints are injected only by recovery/compaction code.
   172	    // Layer 7 — Raw History stays provider-owned for native sessions; custom
   173	    // harnesses use the bounded compaction pipeline instead of this prompt.
   174	    incognito
   175	      ? "Incognito mode: do not use chat/project/global durable memory or personal context. Explicit references supplied in this request remain allowed."
   176	      : "Use retrieved profile and preference memories to resolve known references and adapt tools, commands, language, and formatting when relevant. Treat inferred or low-confidence facts as uncertain, prefer newer confirmed facts, and do not mention unrelated personal context. Personal/context-hub data is retrieval-only: request the smallest useful slice; never dump the database into the prompt.",
   177	  ].filter(Boolean).join("\n\n");
   178	}
