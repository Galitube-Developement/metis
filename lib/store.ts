     1	import { randomUUID } from "node:crypto";
     2	import {
     3	  existsSync,
     4	  mkdirSync,
     5	  readFileSync,
     6	  renameSync,
     7	  unlinkSync,
     8	  writeFileSync,
     9	} from "node:fs";
    10	import path from "node:path";
    11	import { config } from "@/lib/config";
    12	import { RUNTIME_MODES } from "@/lib/runtime-mode";
    13	
    14	export type ToolPart = {
    15	  id: string;
    16	  name: string;
    17	  status: "running" | "completed" | "error" | string;
    18	  detail?: string;
    19	  kind?: "plan" | "edit" | "read" | "shell" | "subagent" | "mcp" | "canvas" | "note" | "todo" | "browser" | "memory" | "automation" | "compaction" | "other";
    20	  source?: "mcp" | "native" | "browser";
    21	  path?: string;
    22	  input?: string;
    23	  result?: string;
    24	  todos?: Array<{ id?: string; content: string; status?: string }>;
    25	  subagent?: {
    26	    agentId?: string;
    27	    chatId?: string;
    28	    title?: string;
    29	    mode?: string;
    30	    model?: string;
    31	    prompt?: string;
    32	    thinking?: string;
    33	    messages?: Array<{ role: string; text: string; timestamp?: string }>;
    34	    tools?: ToolPart[];
    35	  };
    36	  diff?: {
    37	    before?: string;
    38	    after?: string;
    39	    additions?: number;
    40	    deletions?: number;
    41	  };
    42	};
    43	
    44	export type ChatMessage = {
    45	  id: string;
    46	  role: "user" | "assistant" | "system";
    47	  content: string;
    48	  errorMessage?: string;
    49	  referenceText?: string;
    50	  thinking?: string;
    51	  tools?: ToolPart[];
    52	  parts?: MessagePart[];
    53	  suggestions?: Array<string | { label: string; prompt: string }>;
    54	  references?: Array<{
    55	    kind: string;
    56	    id: string;
    57	    label: string;
    58	    source?: "explicit" | "pinned";
    59	    detail?: string;
    60	    path?: string;
    61	    content?: string;
    62	  }>;
    63	  attachments?: Array<{
    64	    id: string;
    65	    name: string;
    66	    mimeType: string;
    67	    kind: "image" | "file";
    68	    storedName: string;
    69	    size: number;
    70	  }>;
    71	  runMetadata?: {
    72	    providerId?: string;
    73	    modelId?: string;
    74	    connectionId?: string;
    75	    outputTokens?: number;
    76	    inputTokens?: number;
    77	    cachedInputTokens?: number;
    78	    cacheWriteInputTokens?: number;
    79	    inputTokensEstimated?: boolean;
    80	    totalTokens?: number;
    81	    totalProcessedTokens?: number;
    82	    contextUsedTokens?: number;
    83	    contextWindow?: number;
    84	    contextWindowSource?: "provider" | "runtime" | "stored-provider" | "registry" | "catalog" | "inferred" | "estimate";
    85	    maxOutputTokens?: number;
    86	    compactsAutomatically?: boolean;
    87	    autoCompactThreshold?: number;
    88	    costUsd?: number;
    89	    completedAt: string;
    90	  };
    91	  createdAt: string;
    92	};
    93	
    94	export type MessagePart =
    95	 | { type: "thinking"; content: string; done?: boolean; durationMs?: number }
    96	 | ({ type: "tool" } & ToolPart)
    97	 | {
    98	 type: "compaction";
    99	 id: string;
   100	 name: "context_compaction";
   101	 kind: "compaction";
   102	 status: "started" | "completed" | "error";
   103	 systemTriggered: true;
   104	 beforeTokens?: number;
   105	 targetTokens?: number;
   106	 afterTokens?: number;
   107	 removedMessages?: number;
   108	 message?: string;
   109	 }
   110	 | { type: "text"; content: string };
   111	
   112	export type WorkspaceItem = {
   113	  id: string;
   114	  type: "canvas" | "plan";
   115	  name: string;
   116	  content: string;
   117	  createdAt: string;
   118	  updatedAt: string;
   119	  version?: number;
   120	  scope?: "chat" | "global";
   121	  idempotencyKey?: string;
   122	};
   123	
   124	export type NoteScope = "global" | "chat" | "workspace";
   125	export type NoteAuthor = "user" | "agent";
   126	
   127	export type NotePosition = {
   128	  x: number;
   129	  y: number;
   130	};
   131	
   132	export type NoteSize = {
   133	  width: number;
   134	  height: number;
   135	};
   136	
   137	export type NoteKind = "note" | "project" | "learned_fact";
   138	
   139	export type NoteTodo = {
   140	  id: string;
   141	  content: string;
   142	  status: "pending" | "in_progress" | "completed";
   143	  chatIds?: string[];
   144	};
   145	
   146	export type SharedNote = {
   147	  id: string;
   148	  ownerId?: string;
   149	  chatId?: string;
   150	  workspaceId?: string;
   151	  scope: NoteScope;
   152	  kind?: NoteKind;
   153	  title: string;
   154	  content: string;
   155	  todos?: NoteTodo[];
   156	  color: string;
   157	  position: NotePosition;
   158	  size: NoteSize;
   159	  author: NoteAuthor;
   160	  createdAt: string;
   161	  updatedAt: string;
   162	  archived: boolean;
   163	  version: number;
   164	  projectId?: string;
   165	};
   166	
   167	export type Project = {
   168	  id: string;
   169	  ownerId?: string;
   170	  name: string;
   171	  icon: string;
   172	  color: string;
   173	  instructions: string;
   174	  memoryMode: "default" | "project_only";
   175	  disabledSkillIds: string[];
   176	  memories: Memory[];
   177	  logoMimeType?: string;
   178	  logoStoredName?: string;
   179	  createdAt: string;
   180	  updatedAt: string;
   181	};
   182	
   183	export type ProjectFile = {
   184	  id: string;
   185	  projectId: string;
   186	  ownerId?: string;
   187	  name: string;
   188	  mimeType: string;
   189	  text?: string;
   190	  storedName?: string;
   191	  size: number;
   192	  createdAt: string;
   193	};
   194	
   195	export type NoteActivity = {
   196	  id: string;
   197	  noteId: string;
   198	  actor: NoteAuthor;
   199	  action: "created" | "updated" | "archived" | "restored" | "deleted";
   200	  createdAt: string;
   201	  summary?: string;
   202	  before?: SharedNote;
   203	  after?: SharedNote;
   204	};
   205	
   206	export type SnapshotAvailability = "available" | "restored" | "needs_attention" | "not_available";
   207	
   208	export type SessionSnapshot = {
   209	  id: string;
   210	  chatId: string;
   211	  ownerId?: string;
   212	  schemaVersion: number;
   213	  createdAt: string;
   214	  updatedAt: string;
   215	  checkpoint: "important" | "periodic" | "shutdown" | "recovery";
   216	  activeWorkspaceId?: string | null;
   217	  workspaceTab?: ChatSessionState["workspaceTab"];
   218	  workspaceOpen?: boolean;
   219	  draft?: string;
   220	  filters?: Record<string, string | boolean | number | null>;
   221	  runStatus: ChatRunStatus;
   222	  resumeMarker?: {
   223	    jobId?: string;
   224	    runId?: string;
   225	    safe: boolean;
   226	    reason?: string;
   227	  };
   228	  browser?: {
   229	    tabs: BrowserTab[];
   230	    activeTabId?: string;
   231	    reachable: boolean;
   232	  };
   233	  terminals?: Array<{
   234	    id: string;
   235	    sessionId?: string;
   236	    cwd: string;
   237	    processId?: number;
   238	    lastOutput?: string;
   239	    exitCode?: number | null;
   240	    running?: boolean;
   241	    reachable: boolean;
   242	  }>;
   243	  notesView?: {
   244	    x: number;
   245	    y: number;
   246	    zoom: number;
   247	    selectedNoteId?: string | null;
   248	  };
   249	  availability: SnapshotAvailability;
   250	  migration?: {
   251	    fromVersion?: number;
   252	    warnings?: string[];
   253	  };
   254	};
   255	
   256	export type VoiceInputSettings = {
   257	  enabled: boolean;
   258	  maxDurationSeconds: number;
   259	  provider: "openai" | "local" | "custom" | "browser";
   260	  modelId: string;
   261	  realtime: boolean;
   262	  endpoint?: string;
   263	  connectionId?: string;
   264	  language?: string;
   265	  autoInsertDraft: boolean;
   266	  deleteAudioAfterTranscription: boolean;
   267	};
   268	
   269	export type VoiceJobStatus = "queued" | "uploading" | "transcribing" | "completed" | "failed" | "cancelled";
   270	
   271	export type VoiceTranscriptionJob = {
   272	  id: string;
   273	  ownerId?: string;
   274	  chatId?: string;
   275	  status: VoiceJobStatus;
   276	  mimeType: string;
   277	  durationSeconds: number;
   278	  sizeBytes: number;
   279	  transcript?: string;
   280	  error?: string;
   281	  createdAt: string;
   282	  updatedAt: string;
   283	};
   284	
   285	export type BrowserTab = {
   286	  id: string;
   287	  title: string;
   288	  url: string;
   289	};
   290	
   291	export type BrowserContext = {
   292	  tabs: BrowserTab[];
   293	  activeTabId: string;
   294	  sessionKey: string;
   295	  updatedAt: string;
   296	};
   297	
   298	export type PendingChatQuestion = {
   299	  questionId: string;
   300	  runId?: string;
   301	  jobId?: string;
   302	  version?: number;
   303	  expiresAt?: string;
   304	  status?: "waiting_for_user" | "answered" | "cancelled" | "expired";
   305	  questions: Array<{
   306	    id: string;
   307	    question: string;
   308	    multiple?: boolean;
   309	    options?: Array<{ label: string; value?: string }>;
   310	  }>;
   311	};
   312	
   313	export type ChatRunStatus =
   314	  | "idle"
   315	  | "running"
   316	  | "paused"
   317	  | "waiting_for_user"
   318	  | "waiting_input"
   319	  | "completed"
   320	  | "cancelled"
   321	  | "failed"
   322	  | "interrupted"
   323	  | "error";
   324	
   325	export type ChatBadge = "blue" | "red";
   326	
   327	export type ChatShare = {
   328	  id: string;
   329	  active: boolean;
   330	  passwordHash?: string;
   331	  content?: {
   332	    attachments?: boolean;
   333	    thinking?: boolean;
   334	    tools?: boolean;
   335	    suggestions?: boolean;
   336	    sources?: boolean;
   337	    workspaces?: boolean;
   338	  };
   339	  createdAt: string;
   340	  updatedAt: string;
   341	};
   342	
   343	export type ChatInputState = {
   344	  composer: string;
   345	  queuedFollowUps: Array<{ id: string; text: string; referenceText?: string }>;
   346	  browserUrl?: string;
   347	  extraFields?: Record<string, unknown>;
   348	  updatedAt: string;
   349	};
   350	
   351	export type ProviderSessionBinding = {
   352	  execution: "cursor-agent" | "codex-sdk" | "claude-agent" | "antigravity-cli" | "grok-cli" | "opencode-cli" | "ai-sdk";
   353	  connectionId: string;
   354	  contextOwner: "native" | "metis";
   355	  /** Cursor/session that completed at least one persisted turn. */
   356	  lastKnownGoodCursor?: string;
   357	  /** Newly observed cursor; promoted only after the turn is durably completed. */
   358	  candidateCursor?: string;
   359	  modelId?: string;
   360	  lastContextTokens?: number;
   361	  lastContextWindow?: number;
   362	  lastCompactionAt?: string;
   363	  recoveryGeneration?: number;
   364	  updatedAt: string;
   365	};
   366	
   367	export type ChatSessionState = {
   368	  input?: string;
   369	  /** ISO timestamp for last-write-wins merge of composer text across devices. */
   370	  inputUpdatedAt?: string;
   371	  queuedUpdatedAt?: string;
   372	  browserUrl?: string;
   373	  browserUrlUpdatedAt?: string;
   374	  extraFields?: Record<string, unknown>;
   375	  remoteCwd?: string;
   376	  terminalCwd?: string;
   377	  fileCwd?: string;
   378	  terminalSessionId?: string;
   379	  terminalTabs?: TerminalTab[];
   380	  activeTerminalTabId?: string;
   381	  workspaceTab?: "canvas" | "plan" | "terminal" | "files" | "browser" | "monitor";
   382	  activeWorkspaceId?: string | null;
   383	  workspaceOpen?: boolean;
   384	  workspaceWidth?: number;
   385	  notesView?: SessionSnapshot["notesView"];
   386	  pinnedNoteIds?: string[];
   387	  unpinnedGlobalNoteIds?: string[];
   388	  filters?: Record<string, string | boolean | number | null>;
   389	  modeId?: string;
   390	  /** Goal set by the built-in /goal command for this chat. */
   391	  goal?: string | null;
   392	  goalReferences?: ChatMessage["references"];
   393	  /** Original chat scope for goal references inherited by a subagent. */
   394	  goalOriginChatId?: string;
   395	  providerSessions?: Record<string, ProviderSessionBinding>;
   396	};
   397	
   398	export type ToolPermissionCategory =
   399	  | "read"
   400	  | "write"
   401	  | "terminal"
   402	  | "browser"
   403	  | "memory"
   404	  | "remote"
   405	  | "plan"
   406	  | "subagent";
   407	
   408	export type AgentMode = {
   409	  id: string;
   410	  name: string;
   411	  description: string;
   412	  icon: string;
   413	  instructions: string;
   414	  allowedCategories: ToolPermissionCategory[];
   415	  toolOverrides?: Record<string, boolean>;
   416	  builtIn?: boolean;
   417	};
   418	
   419	export type TerminalTab = {
   420	  id: string;
   421	  title: string;
   422	  cwd: string;
   423	  sessionId?: string;
   424	};
   425	
   426	export type Chat = {
   427	  id: string;
   428	  ownerId?: string;
   429	  /** Incognito chats are temporary and never appear in normal chat indexes. */
   430	  incognito?: boolean;
   431	  expiresAt?: string;
   432	  title: string;
   433	  titleSource?: "default" | "user" | "agent";
   434	  /** Prevents agent metadata maintenance from changing this chat title. */
   435	  agentTitleLocked?: boolean;
   436	  keywords?: string[];
   437	  agentId?: string;
   438	  /** Selected provider/model key for this chat. */
   439	  modelId?: string;
   440	  /** Runtime execution mode; see lib/runtime-mode.ts. */
   441	  runtimeMode?: string;
   442	  /** Cursor model params, e.g. [{ id: "fast", value: "true" }] */
   443	  modelParams?: Array<{ id: string; value: string }>;
   444	  messages: ChatMessage[];
   445	  /** Server-owned queue deletions used to invalidate stale client snapshots. */
   446	  removedQueuedMessageIds?: string[];
   447	  queuedMessages?: Array<{
   448	    id: string;
   449	    text: string;
   450	    referenceText?: string;
   451	    references?: ChatMessage["references"];
   452	    attachments?: ChatMessage["attachments"];
   453	  }>;
   454	  canvas?: string;
   455	  workspaces?: WorkspaceItem[];
   456	  browserContext?: BrowserContext;
   457	  /** Hidden from the regular chat list; opened from the owning automation run history. */
   458	  automationId?: string;
   459	  automationRunId?: string;
   460	  automationName?: string;
   461	  sessionState?: ChatSessionState;
   462	  runStatus?: ChatRunStatus;
   463	  runUpdatedAt?: string;
   464	  queueMessage?: string;
   465	  pendingQuestion?: PendingChatQuestion;
   466	  pendingApproval?: {
   467	    id: string;
   468	    title: string;
   469	    command?: string;
   470	    files?: Array<{ path: string; status: string }>;
   471	    createdAt: string;
   472	  };
   473	  approvedPatterns?: string[];
   474	  badge?: ChatBadge;
   475	  share?: ChatShare;
   476	  pinned?: boolean;
   477	  archived?: boolean;
   478	  lastMessageSent?: string;
   479	  createdAt: string;
   480	  updatedAt: string;
   481	  projectId?: string;
   482	};
   483	
   484	export type ChatIndexEntry = {
   485	  id: string;
   486	  ownerId?: string;
   487	  title: string;
   488	  agentTitleLocked?: boolean;
   489	  keywords?: string[];
   490	  updatedAt: string;
   491	  createdAt: string;
   492	  agentId?: string;
   493	  modelId?: string;
   494	  runStatus?: ChatRunStatus;
   495	  runUpdatedAt?: string;
   496	  queueMessage?: string;
   497	  pendingQuestion?: PendingChatQuestion;
   498	  pendingApproval?: {
   499	    id: string;
   500	    title: string;
   501	    command?: string;
   502	    files?: Array<{ path: string; status: string }>;
   503	    createdAt: string;
   504	  };
   505	  approvedPatterns?: string[];
   506	  badge?: ChatBadge;
   507	  pinned?: boolean;
   508	  archived?: boolean;
   509	  lastMessageSent?: string;
   510	  share?: Omit<ChatShare, "passwordHash">;
   511	  projectId?: string;
   512	};
   513	
   514	export type Memory = {
   515	  id: string;
   516	  content: string;
   517	  tags?: string[];
   518	  createdAt: string;
   519	  updatedAt: string;
   520	  namespace?: "profile" | "preferences" | "device" | "project" | "infrastructure" | "software" | "workflow" | "semantic";
   521	  topic?: string;
   522	  confidence?: number;
   523	  importance?: number;
   524	  confirmed?: boolean;
   525	  source?: "user" | "conversation";
   526	  state?: "active" | "superseded" | "archived";
   527	  lastUsedAt?: string;
   528	};
   529	
   530	const DATA_DIR = config.dataDir;
   531	const CHATS_DIR = path.join(DATA_DIR, "chats");
   532	const INDEX_PATH = path.join(CHATS_DIR, "index.json");
   533	const MEMORIES_PATH = path.join(DATA_DIR, "memories.json");
   534	const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
   535	
   536	export type GlobalModelSettings = {
   537	  compression?: {
   538	    enabled?: boolean;
   539	    mode?: "lite" | "standard" | "aggressive" | "ultra" | "rtk" | "stacked";
   540	    compressToolResults?: boolean;
   541	    compressChatHistory?: boolean;
   542	  };
   543	  modelId?: string;
   544	  responseInstructions?: string;
   545	  modelParams?: Array<{ id: string; value: string }>;
   546	  modelParamsByModel?: Record<string, Array<{ id: string; value: string }>>;
   547	  lastModelByProvider?: Record<string, string>;
   548	  subagentModelEnabled?: boolean;
   549	  subagentModelId?: string;
   550	  draftInput?: string;
   551	  pinnedNoteIds?: string[];
   552	  favoriteModelKeys?: string[];
   553	  modelAliases?: Record<string, string>;
   554	  browserRealtime?: boolean;
   555	  browserFps?: number;
   556	  browserViewportWidth?: number;
   557	  browserViewportHeight?: number;
   558	  voiceInput?: VoiceInputSettings;
   559	  featureFlags?: {
   560	    plans?: boolean;
   561	    notes?: boolean;
   562	    recovery?: boolean;
   563	    askUserTimeout?: boolean;
   564	    voiceInput?: boolean;
   565	    browser?: boolean;
   566	  };
   567	  customModes?: AgentMode[];
   568	  enabledSkills?: Record<string, boolean>;
   569	  alwaysOnSkills?: Record<string, boolean>;
   570	};
   571	
   572	function ensureDirs() {
   573	  if (!existsSync(CHATS_DIR)) {
   574	    mkdirSync(CHATS_DIR, { recursive: true });
   575	  }
   576	  if (!existsSync(INDEX_PATH)) {
   577	    atomicWriteJson(INDEX_PATH, []);
   578	  }
   579	  if (!existsSync(MEMORIES_PATH)) {
   580	    atomicWriteJson(MEMORIES_PATH, []);
   581	  }
   582	}
   583	
   584	function atomicWriteJson(filePath: string, data: unknown) {
   585	  const dir = path.dirname(filePath);
   586	  if (!existsSync(dir)) {
   587	    mkdirSync(dir, { recursive: true });
   588	  }
   589	  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
   590	  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
   591	  renameSync(tmp, filePath);
   592	}
   593	
   594	function readJsonFile<T>(filePath: string, fallback: T): T {
   595	  try {
   596	    if (!existsSync(filePath)) return fallback;
   597	    const raw = readFileSync(filePath, "utf8");
   598	    if (!raw.trim()) return fallback;
   599	    return JSON.parse(raw) as T;
   600	  } catch {
   601	    return fallback;
   602	  }
   603	}
   604	
   605	function chatPath(id: string) {
   606	  return path.join(CHATS_DIR, `${id}.json`);
   607	}
   608	
   609	function nowIso() {
   610	  return new Date().toISOString();
   611	}
   612	
   613	function normalizeBrowserContext(
   614	  context: BrowserContext | null | undefined,
   615	): BrowserContext | undefined {
   616	  if (!context || !Array.isArray(context.tabs)) return undefined;
   617	  const tabs = context.tabs
   618	    .filter(
   619	      (tab) =>
   620	        tab &&
   621	        typeof tab.id === "string" &&
   622	        typeof tab.title === "string" &&
   623	        typeof tab.url === "string",
   624	    )
   625	    .slice(0, 20)
   626	    .map((tab) => ({
   627	      id: tab.id.slice(0, 200),
   628	      title: tab.title.trim().slice(0, 200) || "New tab",
   629	      url: tab.url.trim().slice(0, 4_000),
   630	    }));
   631	  if (!tabs.length) return undefined;
   632	  return {
   633	    tabs,
   634	    activeTabId: tabs.some((tab) => tab.id === context.activeTabId)
   635	      ? context.activeTabId
   636	      : tabs[0].id,
   637	    sessionKey:
   638	      typeof context.sessionKey === "string"
   639	        ? context.sessionKey.trim().slice(0, 200)
   640	        : "",
   641	    updatedAt: nowIso(),
   642	  };
   643	}
   644	
   645	function sortIndex(entries: ChatIndexEntry[]) {
   646	  return [...entries].sort(
   647	    (a, b) =>
   648	      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
   649	  );
   650	}
   651	
   652	function upsertIndex(entry: ChatIndexEntry) {
   653	  ensureDirs();
   654	  const index = readJsonFile<ChatIndexEntry[]>(INDEX_PATH, []);
   655	  const next = sortIndex([
   656	    entry,
   657	    ...index.filter((e) => e.id !== entry.id),
   658	  ]);
   659	  atomicWriteJson(INDEX_PATH, next);
   660	  return next;
   661	}
   662	
   663	export function listChats(): ChatIndexEntry[] {
   664	  ensureDirs();
   665	  return sortIndex(readJsonFile<ChatIndexEntry[]>(INDEX_PATH, []));
   666	}
   667	
   668	export function listChatsForUser(ownerId?: string): ChatIndexEntry[] {
   669	  const chats = listChats();
   670	  return ownerId ? chats.filter((chat) => !chat.ownerId || chat.ownerId === ownerId) : chats;
   671	}
   672	
   673	export function getChat(id: string, ownerId?: string): Chat | null {
   674	  ensureDirs();
   675	  if (!id || id.includes("/") || id.includes("..")) return null;
   676	  const chat = readJsonFile<Chat | null>(chatPath(id), null);
   677	  if (!chat || chat.id !== id || (ownerId && chat.ownerId && chat.ownerId !== ownerId)) return null;
   678	  return chat;
   679	}
   680	
   681	export function createChat(
   682	  title = "New chat",
   683	  browserContext?: BrowserContext,
   684	  ownerId?: string,
   685	): Chat {
   686	  ensureDirs();
   687	  const ts = nowIso();
   688	  const safeBrowserContext = normalizeBrowserContext(browserContext);
   689	  const chat: Chat = {
   690	    id: randomUUID(),
   691	    ...(ownerId ? { ownerId } : {}),
   692	    title: title.trim() || "New chat",
   693	    messages: [],
   694	    ...(safeBrowserContext ? { browserContext: safeBrowserContext } : {}),
   695	    createdAt: ts,
   696	    updatedAt: ts,
   697	  };
   698	  atomicWriteJson(chatPath(chat.id), chat);
   699	  upsertIndex({
   700	    id: chat.id,
   701	    ownerId: chat.ownerId,
   702	    title: chat.title,
   703	    createdAt: chat.createdAt,
   704	    updatedAt: chat.updatedAt,
   705	    ...(chat.runStatus ? { runStatus: chat.runStatus } : {}),
   706	    ...(chat.runUpdatedAt ? { runUpdatedAt: chat.runUpdatedAt } : {}),
   707	  });
   708	  return chat;
   709	}
   710	
   711	export function saveChat(chat: Chat): Chat {
   712	  ensureDirs();
   713	  const updated: Chat = { ...chat, updatedAt: nowIso() };
   714	  atomicWriteJson(chatPath(updated.id), updated);
   715	  upsertIndex({
   716	    id: updated.id,
   717	    ownerId: updated.ownerId,
   718	    title: updated.title,
   719	    createdAt: updated.createdAt,
   720	    updatedAt: updated.updatedAt,
   721	    agentId: updated.agentId,
   722	    modelId: updated.modelId,
   723	    ...(updated.agentTitleLocked ? { agentTitleLocked: true } : {}),
   724	  });
   725	  return updated;
   726	}
   727	
   728	export function updateChat(
   729	  id: string,
   730	  patch: {
   731	    title?: string;
   732	    titleSource?: "default" | "user" | "agent";
   733	    agentTitleLocked?: boolean;
   734	    agentId?: string | null;
   735	    modelId?: string | null;
   736	    modelParams?: Array<{ id: string; value: string }> | null;
   737	    queuedMessages?: Array<{
   738	      id: string;
   739	      text: string;
   740	      referenceText?: string;
   741	      references?: ChatMessage["references"];
   742	    attachments?: ChatMessage["attachments"];
   743	    }> | null;
   744	    canvas?: string | null;
   745	    workspaces?: WorkspaceItem[] | null;
   746	    browserContext?: BrowserContext | null;
   747	    runStatus?: ChatRunStatus;
   748	    runUpdatedAt?: string | null;
   749	    pendingQuestion?: PendingChatQuestion | null;
   750	    runtimeMode?: string | null;
   751	    pendingApproval?: Chat["pendingApproval"] | null;
   752	    approvedPatterns?: string[] | null;
   753	  },
   754	  ownerId?: string,
   755	): Chat | null {
   756	  const chat = getChat(id, ownerId);
   757	  if (!chat) return null;
   758	  if (typeof patch.title === "string") {
   759	    const title = patch.title.trim();
   760	    if (title) chat.title = title;
   761	  }
   762	  if (patch.titleSource) chat.titleSource = patch.titleSource;
   763	  if (patch.agentTitleLocked !== undefined) {
   764	    chat.agentTitleLocked = patch.agentTitleLocked;
   765	  }
   766	  if (patch.agentId === null) {
   767	    delete chat.agentId;
   768	  } else if (typeof patch.agentId === "string") {
   769	    chat.agentId = patch.agentId.trim() || undefined;
   770	  }
   771	  if (patch.modelId === null) {
   772	    delete chat.modelId;
   773	  } else if (typeof patch.modelId === "string") {
   774	    const next = patch.modelId.trim();
   775	    if (next && next !== chat.modelId) {
   776	      chat.modelId = next;
   777	      // Model change needs a fresh agent session
   778	      delete chat.agentId;
   779	    }
   780	  }
   781	  if (patch.modelParams === null) {
   782	    delete chat.modelParams;
   783	    delete chat.agentId;
   784	  } else if (Array.isArray(patch.modelParams)) {
   785	    const next = patch.modelParams
   786	      .filter((p) => p.id && typeof p.value === "string")
   787	      .map((p) => ({ id: p.id.trim(), value: String(p.value) }));
   788	    const prev = JSON.stringify(chat.modelParams ?? []);
   789	    const serialized = JSON.stringify(next);
   790	    if (prev !== serialized) {
   791	      chat.modelParams = next;
   792	      delete chat.agentId;
   793	    }
   794	  }
   795	  if (patch.queuedMessages === null) {
   796	    delete chat.queuedMessages;
   797	  } else if (Array.isArray(patch.queuedMessages)) {
   798	    chat.queuedMessages = patch.queuedMessages
   799	      .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
   800	      .map((item) => ({
   801	        id: item.id.slice(0, 200),
   802	        text: item.text.slice(0, 100_000),
   803	        ...(typeof item.referenceText === "string" && item.referenceText.trim()
   804	          ? { referenceText: item.referenceText.slice(0, 100_000) }
   805	          : {}),
   806	        ...(Array.isArray(item.references)
   807	          ? {
   808	              references: item.references
   809	                .filter((reference) => reference && typeof reference.id === "string" && typeof reference.kind === "string" && typeof reference.label === "string")
   810	                .slice(0, 20)
   811	                .map((reference) => ({
   812	                  kind: reference.kind.slice(0, 40),
   813	                  id: reference.id.slice(0, 300),
   814	                  label: reference.label.slice(0, 300),
   815	                  ...(reference.source === "explicit" || reference.source === "pinned" ? { source: reference.source } : {}),
   816	                  ...(typeof reference.detail === "string" ? { detail: reference.detail.slice(0, 500) } : {}),
   817	                  ...(typeof reference.path === "string" ? { path: reference.path.slice(0, 4_000) } : {}),
   818	                  ...(typeof reference.content === "string" ? { content: reference.content.slice(0, 8_000) } : {}),
   819	                })),
   820	            }
   821	          : {}),
   822	      }))
   823	      .filter((item) => item.text.trim())
   824	      .slice(0, 50);
   825	  }
   826	  if (patch.canvas === null) {
   827	    delete chat.canvas;
   828	  } else if (typeof patch.canvas === "string") {
   829	    chat.canvas = patch.canvas.slice(0, 100_000);
   830	  }
   831	  if (patch.workspaces === null) {
   832	    delete chat.workspaces;
   833	  } else if (Array.isArray(patch.workspaces)) {
   834	    chat.workspaces = patch.workspaces
   835	      .filter((item) =>
   836	        item &&
   837	        typeof item.id === "string" &&
   838	        (item.type === "canvas" || item.type === "plan") &&
   839	        typeof item.name === "string" &&
   840	        typeof item.content === "string" &&
   841	        typeof item.createdAt === "string" &&
   842	        typeof item.updatedAt === "string",
   843	      )
   844	      .slice(0, 20)
   845	      .map((item) => ({
   846	        id: item.id.slice(0, 200),
   847	        type: item.type,
   848	        name: item.name.trim().slice(0, 200) || (item.type === "plan" ? "Plan" : "Canvas"),
   849	        content: item.content.slice(0, 100_000),
   850	        createdAt: item.createdAt,
   851	        updatedAt: item.updatedAt,
   852	      }));
   853	  }
   854	  if (patch.browserContext === null) {
   855	    delete chat.browserContext;
   856	  } else if (patch.browserContext) {
   857	    const browserContext = normalizeBrowserContext(patch.browserContext);
   858	    if (browserContext) chat.browserContext = browserContext;
   859	  }
   860	  if (patch.runStatus) {
   861	    chat.runStatus = patch.runStatus;
   862	    chat.runUpdatedAt = patch.runUpdatedAt || nowIso();
   863	  } else if (patch.runUpdatedAt === null) {
   864	    delete chat.runUpdatedAt;
   865	  }
   866	  if (patch.runtimeMode === null) {
   867	    delete chat.runtimeMode;
   868	  } else if (typeof patch.runtimeMode === "string") {
   869	    const runtimeMode = patch.runtimeMode.trim();
   870	    if (runtimeMode && (RUNTIME_MODES as readonly string[]).includes(runtimeMode)) {
   871	      chat.runtimeMode = runtimeMode;
   872	    }
   873	  }
   874	  if (patch.pendingApproval === null) {
   875	    delete chat.pendingApproval;
   876	  } else if (patch.pendingApproval) {
   877	    const pendingApproval = patch.pendingApproval;
   878	    if (pendingApproval.id.trim() && pendingApproval.title.trim()) {
   879	      chat.pendingApproval = {
   880	        id: pendingApproval.id.slice(0, 200),
   881	        title: pendingApproval.title.slice(0, 500),
   882	        ...(typeof pendingApproval.command === "string" && pendingApproval.command.trim()
   883	          ? { command: pendingApproval.command.slice(0, 20_000) }
   884	          : {}),
   885	        ...(Array.isArray(pendingApproval.files)
   886	          ? {
   887	              files: pendingApproval.files
   888	                .filter((file) => file && typeof file.path === "string" && file.path.trim())
   889	                .slice(0, 100)
   890	                .map((file) => ({
   891	                  path: file.path.slice(0, 2_000),
   892	                  status: String(file.status || "").slice(0, 100),
   893	                })),
   894	            }
   895	          : {}),
   896	        createdAt: pendingApproval.createdAt || nowIso(),
   897	      };
   898	    }
   899	  }
   900	  if (patch.approvedPatterns === null) {
   901	    delete chat.approvedPatterns;
   902	  } else if (Array.isArray(patch.approvedPatterns)) {
   903	    const approvedPatterns = [...new Set(
   904	      patch.approvedPatterns
   905	        .map((pattern) => String(pattern || "").trim())
   906	        .filter(Boolean),
   907	    )].slice(0, 100);
   908	    if (approvedPatterns.length) chat.approvedPatterns = approvedPatterns;
   909	    else delete chat.approvedPatterns;
   910	  }
   911	  if (patch.pendingQuestion === null) {
   912	    delete chat.pendingQuestion;
   913	  } else if (patch.pendingQuestion) {
   914	    const questions = patch.pendingQuestion.questions
   915	      .filter(
   916	        (question) =>
   917	          question &&
   918	          typeof question.id === "string" &&
   919	          typeof question.question === "string",
   920	      )
   921	      .slice(0, 10)
   922	      .map((question) => ({
   923	        id: question.id.slice(0, 200),
   924	        question: question.question.slice(0, 4_000),
   925	        ...(question.multiple ? { multiple: true } : {}),
   926	        ...(question.options
   927	          ? {
   928	              options: question.options
   929	                .filter(
   930	                  (option) =>
   931	                    option &&
   932	                    typeof option.label === "string" &&
   933	                    (option.value === undefined ||
   934	                      typeof option.value === "string"),
   935	                )
   936	                .slice(0, 20)
   937	                .map((option) => ({
   938	                  label: option.label.slice(0, 500),
   939	                  ...(option.value !== undefined
   940	                    ? { value: option.value.slice(0, 500) }
   941	                    : {}),
   942	                })),
   943	            }
   944	          : {}),
   945	      }));
   946	    if (questions.length > 0) {
   947	      chat.pendingQuestion = {
   948	        questionId: patch.pendingQuestion.questionId.slice(0, 200),
   949	        questions,
   950	      };
   951	    }
   952	  }
   953	  return saveChat(chat);
   954	}
   955	
   956	export function deleteChat(id: string, ownerId?: string): boolean {
   957	  ensureDirs();
   958	  if (ownerId && !getChat(id, ownerId)) return false;
   959	  const file = chatPath(id);
   960	  if (!existsSync(file)) {
   961	    const index = readJsonFile<ChatIndexEntry[]>(INDEX_PATH, []);
   962	    if (!index.some((e) => e.id === id)) return false;
   963	  }
   964	  try {
   965	    if (existsSync(file)) unlinkSync(file);
   966	  } catch {
   967	    /* ignore */
   968	  }
   969	  const index = readJsonFile<ChatIndexEntry[]>(INDEX_PATH, []).filter(
   970	    (e) => e.id !== id,
   971	  );
   972	  atomicWriteJson(INDEX_PATH, index);
   973	  return true;
   974	}
   975	
   976	export function appendMessage(
   977	  chatId: string,
   978	  message: Omit<ChatMessage, "id" | "createdAt"> & {
   979	    id?: string;
   980	    createdAt?: string;
   981	  },
   982	): Chat | null {
   983	  const chat = getChat(chatId);
   984	  if (!chat) return null;
   985	  const msg: ChatMessage = {
   986	    id: message.id || randomUUID(),
   987	    role: message.role,
   988	    content: message.content,
   989	    createdAt: message.createdAt || nowIso(),
   990	  };
   991	  if (typeof message.thinking === "string" && message.thinking.trim()) {
   992	    msg.thinking = message.thinking;
   993	  }
   994	  if (Array.isArray(message.tools) && message.tools.length > 0) {
   995	    msg.tools = message.tools;
   996	  }
   997	  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
   998	    msg.attachments = message.attachments;
   999	  }
  1000	  chat.messages.push(msg);
  1001	  return saveChat(chat);
  1002	}
  1003	
  1004	export function upsertMessage(
  1005	  chatId: string,
  1006	  message: Omit<ChatMessage, "createdAt"> & { createdAt?: string },
  1007	): Chat | null {
  1008	  const chat = getChat(chatId);
  1009	  if (!chat) return null;
  1010	  const index = chat.messages.findIndex((item) => item.id === message.id);
  1011	  const next: ChatMessage = {
  1012	    ...message,
  1013	    createdAt: message.createdAt || chat.messages[index]?.createdAt || nowIso(),
  1014	  };
  1015	  if (index >= 0) chat.messages[index] = next;
  1016	  else chat.messages.push(next);
  1017	  return saveChat(chat);
  1018	}
  1019	
  1020	export function titleFromMessage(content: string): string {
  1021	  const cleaned = content.replace(/\s+/g, " ").trim();
  1022	  if (!cleaned) return "New chat";
  1023	  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
  1024	}
  1025	
  1026	export function listMemories(): Memory[] {
  1027	  ensureDirs();
  1028	  return readJsonFile<Memory[]>(MEMORIES_PATH, []);
  1029	}
  1030	
  1031	export function saveMemories(memories: Memory[]) {
  1032	  ensureDirs();
  1033	  atomicWriteJson(MEMORIES_PATH, memories);
  1034	}
  1035	
  1036	export function getGlobalModelSettings(): GlobalModelSettings {
  1037	  ensureDirs();
  1038	  return readJsonFile<GlobalModelSettings>(SETTINGS_PATH, {});
  1039	}
  1040	
  1041	export function saveGlobalModelSettings(settings: GlobalModelSettings): GlobalModelSettings {
  1042	  ensureDirs();
  1043	  const next = {
  1044	    ...(settings.modelId ? { modelId: settings.modelId } : {}),
  1045	    ...(settings.modelParams ? { modelParams: settings.modelParams } : {}),
  1046	    ...(settings.modelParamsByModel ? { modelParamsByModel: settings.modelParamsByModel } : {}),
  1047	    ...(settings.lastModelByProvider ? { lastModelByProvider: settings.lastModelByProvider } : {}),
  1048	  };
  1049	  atomicWriteJson(SETTINGS_PATH, next);
  1050	  return next;
  1051	}
  1052	
  1053	export function createMemory(content: string, tags?: string[]): Memory {
  1054	  const ts = nowIso();
  1055	  const memory: Memory = {
  1056	    id: randomUUID(),
  1057	    content: content.trim(),
  1058	    tags: tags?.filter(Boolean),
  1059	    createdAt: ts,
  1060	    updatedAt: ts,
  1061	  };
  1062	  const all = listMemories();
  1063	  all.push(memory);
  1064	  saveMemories(all);
  1065	  return memory;
  1066	}
  1067	
  1068	export function updateMemory(
  1069	  id: string,
  1070	  patch: { content?: string; tags?: string[] },
  1071	): Memory | null {
  1072	  const all = listMemories();
  1073	  const idx = all.findIndex((m) => m.id === id);
  1074	  if (idx < 0) return null;
  1075	  const current = all[idx];
  1076	  if (typeof patch.content === "string") {
  1077	    current.content = patch.content.trim();
  1078	  }
  1079	  if (patch.tags) {
  1080	    current.tags = patch.tags.filter(Boolean);
  1081	  }
  1082	  current.updatedAt = nowIso();
  1083	  all[idx] = current;
  1084	  saveMemories(all);
  1085	  return current;
  1086	}
  1087	
  1088	export function deleteMemory(id: string): boolean {
  1089	  const all = listMemories();
  1090	  const next = all.filter((m) => m.id !== id);
  1091	  if (next.length === all.length) return false;
  1092	  saveMemories(next);
  1093	  return true;
  1094	}
  1095	
  1096	export function buildSystemContext(memories: Memory[]): string {
  1097	  const lines =
  1098	    memories.length === 0
  1099	      ? ["(none yet)"]
  1100	      : memories.map((m) => {
  1101	          const tags =
  1102	            m.tags && m.tags.length > 0 ? ` [tags: ${m.tags.join(", ")}]` : "";
  1103	          return `- ${m.content}${tags}`;
  1104	        });
  1105	
  1106	  return `[SYSTEM CONTEXT — not shown to user as reply]
  1107	Memories:
  1108	${lines.join("\n")}
  1109	
  1110	You MAY and SHOULD autonomously:
  1111	- Append/update memories by editing ${path.join(DATA_DIR, "memories.json")}. Keep valid JSON array of { id, content, tags?, createdAt, updatedAt }. Use new UUIDs for new entries; set createdAt/updatedAt to ISO timestamps.
  1112	- Write Cursor rules to ${path.join(config.agentCwd, ".cursor", "rules")}/*.mdc
  1113	- Write skills to ${path.join(config.agentCwd, ".cursor", "skills")}/<name>/SKILL.md
  1114	- Update ${path.join(config.agentCwd, "AGENTS.md")} when lasting preferences appear
  1115	When you learn a durable user preference or fact, save a memory immediately without asking.
  1116	[/SYSTEM CONTEXT]`;
  1117	}
  1118	
  1119	export function getDataPaths() {
  1120	  return { DATA_DIR, CHATS_DIR, INDEX_PATH, MEMORIES_PATH };
  1121	}
