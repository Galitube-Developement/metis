     1	"use client";
     2	
     3	import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
     4	import {
     5	  Archive,
     6	  ArchiveRestore,
     7	  ArrowLeft,
     8	  Bell,
     9	  Brain,
    10	  Check,
    11	  CheckCircle2,
    12	  ChevronDown,
    13	  Download,
    14	  ExternalLink,
    15	  Globe2,
    16	  KeyRound,
    17	  Link2,
    18	  Lock,
    19	  MessagesSquare,
    20	  Mic,
    21	  Monitor,
    22	  MoreHorizontal,
    23	  PlugZap,
    24	  Puzzle,
    25	  Plus,
    26	  RefreshCw,
    27	  RotateCcw,
    28	  Server,
    29	  Settings2,
    30	  ShieldCheck,
    31	  Trash2,
    32	  Users,
    33	  type LucideIcon,
    34	} from "lucide-react";
    35	import { toast } from "sonner";
    36	import { Apple as AppleLogo, Github as GithubLogo, Microsoft as MicrosoftLogo } from "@lobehub/icons";
    37	import { Badge } from "@/components/ui/badge";
    38	import { Button } from "@/components/ui/button";
    39	import {
    40	  Dialog,
    41	  DialogContent,
    42	  DialogDescription,
    43	  DialogHeader,
    44	  DialogTitle,
    45	} from "@/components/ui/dialog";
    46	import {
    47	  DropdownMenu,
    48	  DropdownMenuContent,
    49	  DropdownMenuItem,
    50	  DropdownMenuTrigger,
    51	} from "@/components/ui/dropdown-menu";
    52	import { Input } from "@/components/ui/input";
    53	import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
    54	import type { RemotePermission } from "@/lib/remote-clients";
    55	import { ModelPicker } from "@/components/model-picker";
    56	import { ModelOptionsMenu } from "@/components/model-options-menu";
    57	import { ProviderLogo } from "@/components/provider-logo";
    58	import { Textarea } from "@/components/ui/textarea";
    59	import { Skeleton } from "@/components/ui/skeleton";
    60	import {
    61	  Tabs,
    62	  TabsContent,
    63	  TabsList,
    64	  TabsTrigger,
    65	} from "@/components/ui/tabs";
    66	import { cn } from "@/lib/utils";
    67	import type { MemoryItem } from "@/components/memories-panel";
    68	import { ConfirmDialog } from "@/components/confirm-dialog";
    69	import { SkillsSettings } from "@/components/skills-settings";
    70	import { AdminUsersPanel } from "@/components/admin-users-panel";
    71	import type { AgentMode, ToolPermissionCategory } from "@/lib/store";
    72	import { TOOL_PERMISSION_CATEGORIES } from "@/lib/modes";
    73	import { PlanUsagePanel } from "@/components/quota-gauges";
    74	import { UpdateSettingsPanel, UpdateStatusProbe } from "@/components/update-channel-nav";
    75	import { CliVersionsPanel } from "@/components/cli-versions-panel";
    76	import { BrowserSettingsControls } from "@/components/browser-settings-controls";
    77	import type { UsageSnapshot } from "@/lib/usage-display";
    78	
    79	type ProviderDefinition = {
    80	  key: string;
    81	  name: string;
    82	  description: string;
    83	  kind: string;
    84	  authTypes: string[];
    85	  defaultBaseUrl?: string;
    86	  capabilities: Record<string, boolean>;
    87	  models: Array<{ id: string; displayName: string; tags?: string[] }>;
    88	  setupHint: string;
    89	};
    90	
    91	type ProviderConnection = {
    92	  id: string;
    93	  providerKey: string;
    94	  slug: string;
    95	  label: string;
    96	  authType: string;
    97	  baseUrl?: string;
    98	  config?: Record<string, unknown>;
    99	  enabled: boolean;
   100	  hasSecret: boolean;
   101	  lastCheckedAt?: string;
   102	  lastError?: string;
   103	};
   104	
   105	function preferredAuthType(provider: ProviderDefinition) {
   106	  return provider.authTypes[0] || "api_key";
   107	}
   108	
   109	type OAuthFlow = {
   110	  id: string;
   111	  connectionId: string;
   112	  providerKey: string;
   113	  status: "starting" | "awaiting_auth" | "awaiting_code" | "completed" | "error" | "cancelled";
   114	  authUrl?: string;
   115	  instructions?: string;
   116	  userCode?: string;
   117	  error?: string;
   118	  manualInputRequired?: boolean;
   119	};
   120	
   121	type CustomSelectOption = {
   122	  value: string;
   123	  label: string;
   124	  providerLogo?: string;
   125	};
   126	
   127	function CustomSelect({
   128	  value,
   129	  options,
   130	  onValueChange,
   131	  ariaLabel,
   132	  disabled = false,
   133	  className,
   134	}: {
   135	  value: string;
   136	  options: CustomSelectOption[];
   137	  onValueChange: (value: string) => void;
   138	  ariaLabel: string;
   139	  disabled?: boolean;
   140	  className?: string;
   141	}) {
   142	  const selected = options.find((option) => option.value === value) || options[0];
   143	  return (
   144	    <DropdownMenu>
   145	      <DropdownMenuTrigger asChild>
   146	        <Button
   147	          type="button"
   148	          variant="outline"
   149	          disabled={disabled || !selected}
   150	          aria-label={ariaLabel}
   151	          className={cn("h-9 min-w-0 justify-between gap-2 text-left font-normal", className)}
   152	        >
   153	          <span className="flex min-w-0 items-center gap-2">
   154	            {selected?.providerLogo ? (
   155	              <ProviderLogo providerId={selected.providerLogo} className="size-4 shrink-0" />
   156	            ) : null}
   157	            <span className="min-w-0 truncate">{selected?.label || "Select…"}</span>
   158	          </span>
   159	          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
   160	        </Button>
   161	      </DropdownMenuTrigger>
   162	      <DropdownMenuContent align="start" className="max-h-96 min-w-[14rem] overflow-y-auto">
   163	        {options.map((option) => (
   164	          <DropdownMenuItem
   165	            key={option.value}
   166	            onClick={() => onValueChange(option.value)}
   167	            className="gap-2"
   168	          >
   169	            <Check className={cn("size-3.5 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
   170	            {option.providerLogo ? (
   171	              <ProviderLogo providerId={option.providerLogo} className="size-4 shrink-0" />
   172	            ) : null}
   173	            <span className="truncate">{option.label}</span>
   174	          </DropdownMenuItem>
   175	        ))}
   176	      </DropdownMenuContent>
   177	    </DropdownMenu>
   178	  );
   179	}
   180	
   181	type McpServer = {
   182	  id: string;
   183	  name: string;
   184	  kind: "remote" | "stdio";
   185	  url?: string;
   186	  command?: string;
   187	  args?: string[];
   188	  enabled?: boolean;
   189	  configured_env_keys?: string[];
   190	  configured_header_keys?: string[];
   191	};
   192	
   193	type RemoteClient = {
   194	  id: string;
   195	  name: string;
   196	  status: "online" | "offline" | "revoked";
   197	  os?: string;
   198	  version?: string;
   199	  architecture?: string;
   200	  hostname?: string;
   201	  lastSeenAt?: string;
   202	  policy: { mode: "restricted" | "approval_required" | "full_access"; allowlist: string[]; permissions: RemotePermission[] };
   203	  permissionMode: "user" | "admin";
   204	  capabilities?: string[];
   205	};
   206	
   207	type DesktopPermissionStatus = {
   208	  available: boolean;
   209	  accessibility?: boolean;
   210	  screenRecording?: boolean;
   211	  monitors?: number;
   212	  backend?: string;
   213	  reason?: string;
   214	};
   215	
   216	type ArchivedChat = {
   217	  id: string;
   218	  title: string;
   219	  updatedAt: string;
   220	  pinned?: boolean;
   221	  archived?: boolean;
   222	  share?: {
   223	    id: string;
   224	    active: boolean;
   225	    passwordProtected: boolean;
   226	  };
   227	};
   228	
   229	type McpDraft = {
   230	  id: string;
   231	  name: string;
   232	  kind: "remote" | "stdio";
   233	  url: string;
   234	  command: string;
   235	  args: string;
   236	  env: string;
   237	  headers: string;
   238	};
   239	
   240	const emptyMcpDraft: McpDraft = {
   241	  id: "",
   242	  name: "",
   243	  kind: "remote",
   244	  url: "",
   245	  command: "",
   246	  args: "",
   247	  env: "",
   248	  headers: "",
   249	};
   250	
   251	const API_KEY_URLS: Record<string, string> = {
   252	  cursor: "https://cursor.com/dashboard/api",
   253	  openai: "https://platform.openai.com/api-keys",
   254	  anthropic: "https://console.anthropic.com/settings/keys",
   255	  google: "https://aistudio.google.com/app/apikey",
   256	  antigravity: "https://aistudio.google.com/app/apikey",
   257	  xai: "https://console.x.ai/",
   258	  openrouter: "https://openrouter.ai/keys",
   259	};
   260	
   261	export type ModelParamValue = {
   262	  value: string;
   263	  displayName?: string;
   264	};
   265	
   266	export type ModelParameter = {
   267	  id: string;
   268	  displayName?: string;
   269	  values: ModelParamValue[];
   270	};
   271	
   272	export type ModelParamSelection = {
   273	  id: string;
   274	  value: string;
   275	};
   276	
   277	export type ModelInfo = {
   278	  id: string;
   279	  displayName: string;
   280	  contextWindow?: number;
   281	  description?: string;
   282	  providerId?: string;
   283	  providerName?: string;
   284	  connectionId?: string;
   285	  connectionLabel?: string;
   286	  source?: "cursor" | "catalog" | "discovered";
   287	  tags?: string[];
   288	  capabilities?: Record<string, boolean>;
   289	  parameters?: ModelParameter[];
   290	  defaultParams?: ModelParamSelection[];
   291	};
   292	
   293	export type FinishSound = {
   294	  name: string;
   295	  dataUrl: string;
   296	};
   297	
   298	type Props = {
   299	  open: boolean;
   300	  onOpenChange: (open: boolean) => void;
   301	  settingsTab: string;
   302	  onSettingsTabChange: (tab: string) => void;
   303	  memories: MemoryItem[];
   304	  notificationsEnabled: boolean;
   305	  onNotificationsEnabledChange: (enabled: boolean) => void;
   306	  soundCuesEnabled: boolean;
   307	  onSoundCuesEnabledChange: (enabled: boolean) => void;
   308	  voiceInputEnabled: boolean;
   309	  voiceMaxDurationSeconds: number;
   310	  voiceProvider: "openai" | "local" | "custom" | "browser";
   311	  voiceModelId: string;
   312	  voiceRealtime: boolean;
   313	  voiceEndpoint: string;
   314	  onVoiceApiKeySave: (apiKey: string) => Promise<void>;
   315	  onVoiceInputSettingsChange: (settings: {
   316	    enabled?: boolean;
   317	    maxDurationSeconds?: number;
   318	    provider?: "openai" | "local" | "custom" | "browser";
   319	    modelId?: string;
   320	    realtime?: boolean;
   321	    endpoint?: string;
   322	  }) => void;
   323	  browserEnabled: boolean;
   324	  browserRealtime: boolean;
   325	  browserFps: number;
   326	  browserViewportWidth: number;
   327	  browserViewportHeight: number;
   328	  onBrowserSettingsChange: (settings: {
   329	    browserEnabled?: boolean;
   330	    browserRealtime?: boolean;
   331	    browserFps?: number;
   332	    browserViewportWidth?: number;
   333	    browserViewportHeight?: number;
   334	  }) => void;
   335	  compressionEnabled: boolean;
   336	  compressionMode: "lite" | "standard" | "aggressive" | "ultra" | "rtk" | "stacked";
   337	  compressionToolResults: boolean;
   338	  compressionChatHistory: boolean;
   339	  onCompressionSettingsChange: (settings: {
   340	    enabled?: boolean;
   341	    mode?: "lite" | "standard" | "aggressive" | "ultra" | "rtk" | "stacked";
   342	    compressToolResults?: boolean;
   343	    compressChatHistory?: boolean;
   344	  }) => void;
   345	  models: ModelInfo[];
   346	  favoriteModelKeys: string[];
   347	  onToggleFavoriteModel: (modelId: string) => void;
   348	  subagentModelEnabled: boolean;
   349	  onSubagentModelEnabledChange: (enabled: boolean) => void;
   350	  subagentModelId: string;
   351	  onSubagentModelIdChange: (modelId: string) => void;
   352	  subagentModelParams: ModelParamSelection[];
   353	  onSubagentModelParamsChange: (params: ModelParamSelection[]) => void;
   354	  finishSound: FinishSound | null;
   355	  onFinishSoundChange: (sound: FinishSound | null) => void;
   356	  onTestFinishSound: () => void;
   357	  onMemoriesChanged: () => void;
   358	  onMemoryDeleted: (id: string) => void;
   359	  onChatsChanged: () => void;
   360	  usageSnapshot: UsageSnapshot | null;
   361	  onRefreshUsage: () => Promise<void>;
   362	  onModelsChanged?: () => void;
   363	  onModesChanged?: () => void;
   364	  onLogout: () => void;
   365	  onResetMetis?: () => Promise<void>;
   366	  onUpdateMetis?: () => Promise<void>;
   367	  isHostAdmin?: boolean;
   368	};
   369	
   370	const SETTINGS_SECTIONS: Record<string, Array<{ id: string; label: string }>> = {
   371	  general: [
   372	    { id: "settings-subagent-model", label: "Subagent model" },
   373	    { id: "settings-token-compression", label: "Token compression" },
   374	    { id: "settings-notifications", label: "Notifications" },
   375	    { id: "settings-voice-input", label: "Voice input" },
   376	    { id: "settings-browser", label: "Browser" },
   377	    { id: "settings-browser-storage", label: "Browser storage" },
   378	    { id: "settings-session", label: "Session" },
   379	    { id: "settings-links", label: "Links" },
   380	  ],
   381	  models: [
   382	    { id: "settings-usage", label: "Usage" },
   383	    { id: "settings-providers", label: "Providers" },
   384	    { id: "settings-versions", label: "Versions" },
   385	  ],
   386	  agent: [
   387	    { id: "settings-skills", label: "Skills" },
   388	    { id: "settings-modes", label: "Agent modes" },
   389	    { id: "settings-mcp", label: "MCP servers" },
   390	    { id: "settings-memories", label: "Agent Rules" },
   391	    { id: "settings-response-instructions", label: "Response instructions" },
   392	  ],
   393	  devices: [
   394	    { id: "settings-remote-clients", label: "Remote clients" },
   395	  ],
   396	  admin: [
   397	    { id: "settings-users", label: "Users" },
   398	    { id: "settings-archived", label: "Archived chats" },
   399	    { id: "settings-shared", label: "Shared chats" },
   400	    { id: "settings-maintenance", label: "Maintenance" },
   401	  ],
   402	};
   403	
   404	const SETTINGS_TABS = [
   405	 { value: "general", label: "General" },
   406	 { value: "models", label: "Models" },
   407	 { value: "agent", label: "Agent" },
   408	 { value: "devices", label: "Devices" },
   409	 { value: "admin", label: "Admin" },
   410	 { value: "updates", label: "Updates" },
   411	] as const;
   412	
   413	function visibleSettingsSections(tab: string, isHostAdmin: boolean) {
   414	 return (SETTINGS_SECTIONS[tab] || []).filter((item) => {
   415	 if (!isHostAdmin && (item.id === "settings-users" || item.id === "settings-maintenance")) return false;
   416	 return true;
   417	 });
   418	}
   419	
   420	function scrollSettingsSection(id: string) {
   421	  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
   422	}
   423	
   424	type SettingsPaneId =
   425	  | "tab"
   426	  | "browser-storage"
   427	  | "providers"
   428	  | "versions"
   429	  | "skills"
   430	  | "modes"
   431	  | "mcp"
   432	  | "memories"
   433	  | "response-instructions";
   434	
   435	const SETTINGS_SECTION_TO_PANE: Partial<Record<string, Exclude<SettingsPaneId, "tab">>> = {
   436	  "settings-browser-storage": "browser-storage",
   437	  "settings-providers": "providers",
   438	  "settings-versions": "versions",
   439	  "settings-skills": "skills",
   440	  "settings-modes": "modes",
   441	  "settings-mcp": "mcp",
   442	  "settings-memories": "memories",
   443	  "settings-response-instructions": "response-instructions",
   444	};
   445	
   446	function SettingsTile({
   447	  id,
   448	  title,
   449	  meta,
   450	  icon: Icon,
   451	  onOpen,
   452	}: {
   453	  id: string;
   454	  title: string;
   455	  meta: string;
   456	  icon: LucideIcon;
   457	  onOpen: () => void;
   458	}) {
   459	  return (
   460	    <button
   461	      type="button"
   462	      id={id}
   463	      data-settings-tile={id}
   464	      onClick={onOpen}
   465	      className={cn(
   466	        "flex min-h-[6.25rem] flex-col items-start justify-between rounded-xl px-3.5 py-3 text-left transition-colors",
   467	        "bg-muted/35 text-foreground hover:bg-muted/55",
   468	        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
   469	      )}
   470	    >
   471	      <Icon className="size-4 text-muted-foreground" />
   472	      <span className="mt-3 min-w-0">
   473	        <span className="block text-sm font-medium">{title}</span>
   474	        <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
   475	      </span>
   476	    </button>
   477	  );
   478	}
   479	
   480	function SettingsFeaturePane({
   481	  backLabel,
   482	  title,
   483	  description,
   484	  slot,
   485	  onBack,
   486	  children,
   487	}: {
   488	  backLabel: string;
   489	  title?: string;
   490	  description?: string;
   491	  slot: string;
   492	  onBack: () => void;
   493	  children: ReactNode;
   494	}) {
   495	  return (
   496	    <div className="flex h-full min-h-0 flex-col gap-5 px-6 py-6 sm:px-8 sm:py-8" data-slot={slot}>
   497	      <button
   498	        type="button"
   499	        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
   500	        onClick={onBack}
   501	      >
   502	        <ArrowLeft className="size-3.5" />
   503	        Back to {backLabel}
   504	      </button>
   505	      {title ? (
   506	      <div>
   507	        <h3 className="text-sm font-medium">{title}</h3>
   508	        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
   509	      </div>
   510	      ) : null}
   511	      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
   512	    </div>
   513	  );
   514	}
   515	
   516	const REMOTE_PERMISSION_OPTIONS: Array<{ value: RemotePermission; label: string }> = [
   517	  { value: "get_info", label: "Device information" },
   518	  { value: "list_directory", label: "List folders" },
   519	  { value: "read_file", label: "Read files" },
   520	  { value: "write_file", label: "Create files" },
   521	  { value: "edit_file", label: "Edit files" },
   522	  { value: "delete_file", label: "Delete files" },
   523	  { value: "execute_command", label: "Run allowlisted commands" },
   524	  { value: "terminal", label: "Interactive terminal" },
   525	];
   526	
   527	function RemotePermissionsEditor({
   528	  client,
   529	  onSave,
   530	  desktopStatus,
   531	  desktopBusy,
   532	  onCheckDesktop,
   533	}: {
   534	  client: RemoteClient;
   535	  onSave: (client: RemoteClient, policy: RemoteClient["policy"]) => Promise<void>;
   536	  desktopStatus?: DesktopPermissionStatus;
   537	  desktopBusy?: boolean;
   538	  onCheckDesktop?: (prompt?: boolean) => Promise<void>;
   539	}) {
   540	  const [open, setOpen] = useState(false);
   541	  const [permissions, setPermissions] = useState<RemotePermission[]>(client.policy.permissions);
   542	  const [fullAccess, setFullAccess] = useState(client.policy.mode === "full_access");
   543	  const [allowlistDraft, setAllowlistDraft] = useState(client.policy.allowlist.join("\n"));
   544	  const [saving, setSaving] = useState(false);
   545	  const supportsComputerUse = client.capabilities?.includes("desktop_gui");
   546	  const fullAccessPermissions: RemotePermission[] = [
   547	    ...REMOTE_PERMISSION_OPTIONS.map(({ value }) => value),
   548	    ...(supportsComputerUse ? ["computer_use" as const] : []),
   549	  ];
   550	
   551	  const save = async () => {
   552	    setSaving(true);
   553	    try {
   554	      await onSave(client, {
   555	        ...client.policy,
   556	        mode: fullAccess ? "full_access" : client.policy.mode === "restricted" ? "restricted" : "approval_required",
   557	        permissions: fullAccess ? fullAccessPermissions : permissions,
   558	        allowlist: allowlistDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
   559	      });
   560	      setOpen(false);
   561	      toast.success(`Permissions saved for ${client.name}`);
   562	    } catch (error) {
   563	      toast.error(error instanceof Error ? error.message : "Could not save permissions");
   564	    } finally {
   565	      setSaving(false);
   566	    }
   567	  };
   568	
   569	  return (
   570	    <Popover open={open} onOpenChange={(next) => {
   571	      if (next) {
   572	        setPermissions(client.policy.permissions);
   573	        setFullAccess(client.policy.mode === "full_access");
   574	        setAllowlistDraft(client.policy.allowlist.join("\n"));
   575	      }
   576	      setOpen(next);
   577	    }}>
   578	      <PopoverTrigger asChild>
   579	        <Button type="button" size="sm" variant="outline" aria-label={`Permissions for ${client.name}`}>
   580	          Permissions <ChevronDown className="size-3.5" />
   581	        </Button>
   582	      </PopoverTrigger>
   583	      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3">
   584	        <div>
   585	          <p className="text-sm font-medium">Device permissions</p>
   586	          <p className="text-xs text-muted-foreground">Choose what Metis can do on this device.</p>
   587	        </div>
   588	        <div className="grid gap-1">
   589	          <label className="flex min-h-9 items-center gap-2 rounded-md px-1 text-xs font-medium hover:bg-accent">
   590	            <input
   591	              type="checkbox"
   592	              checked={fullAccess}
   593	              onChange={(event) => setFullAccess(event.target.checked)}
   594	              className="size-4 accent-primary"
   595	            />
   596	            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
   597	            <span>Full Access</span>
   598	          </label>
   599	          {REMOTE_PERMISSION_OPTIONS.map(({ value, label }) => (
   600	            <label key={value} className={cn("flex min-h-8 items-center gap-2 rounded-md px-1 text-xs", fullAccess ? "cursor-not-allowed text-muted-foreground opacity-50" : "hover:bg-accent")}>
   601	              <input
   602	                type="checkbox"
   603	                checked={value === "terminal" && client.permissionMode === "user" ? false : fullAccess || permissions.includes(value)}
   604	                disabled={fullAccess || (value === "terminal" && client.permissionMode === "user")}
   605	                onChange={(event) => setPermissions((current) => event.target.checked
   606	                  ? [...current, value]
   607	                  : current.filter((item) => item !== value))}
   608	                className="size-4 accent-primary"
   609	              />
   610	              <span>{label}</span>
   611	            </label>
   612	          ))}
   613	        </div>
   614	        <label className="flex min-h-10 items-center gap-2 border-t pt-2 text-xs">
   615	          <input
   616	            type="checkbox"
   617	            role="switch"
   618	            aria-checked={supportsComputerUse && (fullAccess || permissions.includes("computer_use"))}
   619	            checked={supportsComputerUse && (fullAccess || permissions.includes("computer_use"))}
   620	            disabled={!supportsComputerUse || fullAccess}
   621	            onChange={(event) => setPermissions((current) => event.target.checked
   622	              ? [...current, "computer_use"]
   623	              : current.filter((item) => item !== "computer_use"))}
   624	            className="size-4 accent-primary"
   625	          />
   626	          <span><span className="font-medium">Computer Use</span><span className="block text-muted-foreground">Screen, mouse, and keyboard. Managed here for Windows, macOS and Linux X11 devices with an interactive display.</span></span>
   627	        </label>
   628	        {supportsComputerUse ? (
   629	          <div className="space-y-2 rounded-md border border-border/70 p-2">
   630	            <p className="text-xs font-medium">OS permission check</p>
   631	            {desktopStatus ? (
   632	              <ul className="space-y-1 text-xs">
   633	                {typeof desktopStatus.screenRecording === "boolean" ? <li>Screen Recording: {desktopStatus.screenRecording ? "on" : "off"}</li> : null}
   634	                {typeof desktopStatus.accessibility === "boolean" ? <li>Accessibility: {desktopStatus.accessibility ? "on" : "off"}</li> : null}
   635	                {typeof desktopStatus.monitors === "number" ? <li>Displays: {desktopStatus.monitors}</li> : null}
   636	                {desktopStatus.backend ? <li>Backend: {desktopStatus.backend}</li> : null}
   637	                <li>Desktop control: {desktopStatus.available ? "ready" : "blocked"}</li>
   638	              </ul>
   639	            ) : (
   640	              <p className="text-xs text-muted-foreground">{client.status === "online" ? "Checking this device…" : "Device must be online to check OS permissions."}</p>
   641	            )}
   642	            {desktopStatus?.reason ? <p className="text-xs text-muted-foreground">{desktopStatus.reason}</p> : null}
   643	            <div className="flex flex-wrap gap-2">
   644	              <Button type="button" size="sm" variant="outline" disabled={desktopBusy || client.status !== "online"} onClick={() => void onCheckDesktop?.(false)}>Check now</Button>
   645	              {String(client.os || "").toLowerCase().includes("mac") ? (
   646	                <Button type="button" size="sm" variant="outline" disabled={desktopBusy || client.status !== "online"} onClick={() => void onCheckDesktop?.(true)}>Grant on Mac</Button>
   647	              ) : null}
   648	            </div>
   649	          </div>
   650	        ) : null}
   651	        {client.permissionMode === "user" ? <p className="text-xs text-muted-foreground">Interactive terminal requires admin pairing.</p> : null}
   652	        <div className={cn("space-y-1", fullAccess && "opacity-50")}>
   653	          <label htmlFor={`allowlist-${client.id}`} className="text-xs font-medium">Device command allowlist</label>
   654	          <Textarea
   655	            id={`allowlist-${client.id}`}
   656	            value={allowlistDraft}
   657	            onChange={(event) => setAllowlistDraft(event.target.value)}
   658	            disabled={fullAccess}
   659	            placeholder={"One exact command per line\ne.g. whoami"}
   660	            rows={3}
   661	            className="font-mono text-xs"
   662	          />
   663	          <p className="text-xs text-muted-foreground">Global commands also apply. Commands require the permission above.</p>
   664	        </div>
   665	        <Button type="button" size="sm" className="w-full" disabled={saving} onClick={() => void save()}>
   666	          {saving ? "Saving…" : "Save permissions"}
   667	        </Button>
   668	      </PopoverContent>
   669	    </Popover>
   670	  );
   671	}
   672	
   673	export function SettingsPanel({
   674	  open,
   675	  onOpenChange,
   676	  settingsTab,
   677	  onSettingsTabChange,
   678	  memories,
   679	  notificationsEnabled,
   680	  onNotificationsEnabledChange,
   681	  soundCuesEnabled,
   682	  onSoundCuesEnabledChange,
   683	  voiceInputEnabled,
   684	  voiceMaxDurationSeconds,
   685	  voiceProvider,
   686	  voiceModelId,
   687	  voiceRealtime,
   688	  voiceEndpoint,
   689	  onVoiceApiKeySave,
   690	  onVoiceInputSettingsChange,
   691	  browserEnabled,
   692	  browserRealtime,
   693	  browserFps,
   694	  browserViewportWidth,
   695	  browserViewportHeight,
   696	  onBrowserSettingsChange,
   697	  compressionEnabled,
   698	  compressionMode,
   699	  compressionToolResults,
   700	  compressionChatHistory,
   701	  onCompressionSettingsChange,
   702	  models,
   703	  favoriteModelKeys,
   704	  onToggleFavoriteModel,
   705	  subagentModelEnabled,
   706	  onSubagentModelEnabledChange,
   707	  subagentModelId,
   708	  onSubagentModelIdChange,
   709	  subagentModelParams,
   710	  onSubagentModelParamsChange,
   711	  finishSound,
   712	  onFinishSoundChange,
   713	  onTestFinishSound,
   714	  onMemoriesChanged,
   715	  onMemoryDeleted,
   716	  onChatsChanged,
   717	  usageSnapshot,
   718	  onRefreshUsage,
   719	  onModelsChanged,
   720	  onModesChanged,
   721	  onLogout,
   722	  onResetMetis,
   723	  onUpdateMetis,
   724	  isHostAdmin = false,
   725	}: Props) {
   726	  const [draft, setDraft] = useState("");
   727	  const [busy, setBusy] = useState(false);
   728	  const [deletingMemoryIds, setDeletingMemoryIds] = useState<Set<string>>(
   729	    () => new Set(),
   730	  );
   731	  type BrowserStorageItem = {
   732	    origin: string;
   733	    storageTypes: string[];
   734	    lastAccess?: string;
   735	    sizeBytes: number;
   736	    cookies: Array<{ name: string; domain: string; path: string; expires: number; size: number }>;
   737	    localStorage: Array<{ key: string; value: string }>;
   738	    sessionStorage: Array<{ key: string; value: string }>;
   739	  };
   740	  const [browserStorage, setBrowserStorage] = useState<BrowserStorageItem[]>([]);
   741	  const [browserStorageLoading, setBrowserStorageLoading] = useState(false);
   742	  const [expandedBrowserOrigin, setExpandedBrowserOrigin] = useState<string | null>(null);
   743	  const [browserStorageDraft, setBrowserStorageDraft] = useState({ type: "cookie" as "cookie" | "localStorage" | "sessionStorage", name: "", value: "" });
   744	  const [browserStorageSaving, setBrowserStorageSaving] = useState(false);
   745	  const [browserStorageError, setBrowserStorageError] = useState("");
   746	  const [browserStorageDeleteTarget, setBrowserStorageDeleteTarget] = useState<string | null>(null);
   747	  const [browserStorageClearAll, setBrowserStorageClearAll] = useState(false);
   748	  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>("tab");
   749	  const [responseInstructions, setResponseInstructions] = useState("");
   750	  const [responseInstructionsLoaded, setResponseInstructionsLoaded] = useState(false);
   751	  const [responseInstructionsBusy, setResponseInstructionsBusy] = useState(false);
   752	  const [responseInstructionsError, setResponseInstructionsError] = useState("");
   753	  const [responseInstructionsSaved, setResponseInstructionsSaved] = useState(false);
   754	  const [responseInstructionsReload, setResponseInstructionsReload] = useState(0);
   755	
   756	  useEffect(() => {
   757	    if (!open || settingsPane !== "response-instructions") return;
   758	    let cancelled = false;
   759	    setResponseInstructionsLoaded(false);
   760	    setResponseInstructionsError("");
   761	    void fetch("/api/preferences")
   762	      .then(async (response) => {
   763	        const data = await response.json();
   764	        if (!response.ok) throw new Error(data.error || "Could not load response instructions.");
   765	        if (!cancelled) setResponseInstructions(typeof data.settings?.responseInstructions === "string" ? data.settings.responseInstructions : "");
   766	      })
   767	      .catch((error) => { if (!cancelled) setResponseInstructionsError(error instanceof Error ? error.message : "Could not load response instructions."); })
   768	      .finally(() => { if (!cancelled) setResponseInstructionsLoaded(true); });
   769	    return () => { cancelled = true; };
   770	  }, [open, settingsPane, responseInstructionsReload]);
   771	
   772	  const saveResponseInstructions = async () => {
   773	    setResponseInstructionsBusy(true);
   774	    setResponseInstructionsError("");
   775	    setResponseInstructionsSaved(false);
   776	    try {
   777	      const response = await fetch("/api/preferences", {
   778	        method: "PATCH",
   779	        headers: { "Content-Type": "application/json" },
   780	        body: JSON.stringify({ responseInstructions }),
   781	      });
   782	      const data = await response.json();
   783	      if (!response.ok) throw new Error(data.error || "Could not save response instructions.");
   784	      setResponseInstructions(typeof data.settings?.responseInstructions === "string" ? data.settings.responseInstructions : responseInstructions);
   785	      setResponseInstructionsSaved(true);
   786	    } catch (error) {
   787	      setResponseInstructionsError(error instanceof Error ? error.message : "Could not save response instructions.");
   788	    } finally {
   789	      setResponseInstructionsBusy(false);
   790	    }
   791	  };
   792	  const [updateAvailable, setUpdateAvailable] = useState(false);
   793	  const [browserStorageQuery, setBrowserStorageQuery] = useState("");
   794	  const [compressionPreview, setCompressionPreview] = useState("");
   795	  const [compressionPreviewResult, setCompressionPreviewResult] = useState<{
   796	    text: string;
   797	    inputChars: number;
   798	    outputChars: number;
   799	    savingsPercent: number;
   800	  } | null>(null);
   801	  const [compressionPreviewBusy, setCompressionPreviewBusy] = useState(false);
   802	  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
   803	  const [mcpLoaded, setMcpLoaded] = useState(false);
   804	  const [mcpDraft, setMcpDraft] = useState<McpDraft>(emptyMcpDraft);
   805	  const [mcpBusy, setMcpBusy] = useState(false);
   806	  const [remoteClients, setRemoteClients] = useState<RemoteClient[]>([]);
   807	  const [desktopStatusById, setDesktopStatusById] = useState<Record<string, DesktopPermissionStatus>>({});
   808	  const [desktopStatusBusyId, setDesktopStatusBusyId] = useState("");
   809	  const desktopStatusChecked = useRef<Set<string>>(new Set());
   810	  const [remoteGlobalAllowlistDraft, setRemoteGlobalAllowlistDraft] = useState("");
   811	  const [remoteGlobalAllowlistBusy, setRemoteGlobalAllowlistBusy] = useState(false);
   812	  const [remoteGlobalAllowlistLoaded, setRemoteGlobalAllowlistLoaded] = useState(false);
   813	  const [remoteGlobalAllowlistError, setRemoteGlobalAllowlistError] = useState("");
   814	  const [remoteCommand, setRemoteCommand] = useState("");
   815	  const [remotePairToken, setRemotePairToken] = useState("");
   816	  const [remoteServerUrl, setRemoteServerUrl] = useState("");
   817	  const [remoteInstallerUrls, setRemoteInstallerUrls] = useState<Array<{ label: string; url: string }>>([]);
   818	  const [remoteCommands, setRemoteCommands] = useState<{ linux: string; windows: string; macos: string } | null>(null);
   819	  const [remotePlatform, setRemotePlatform] = useState<"linux" | "windows" | "macos">("linux");
   820	  const [remotePermissionMode, setRemotePermissionMode] = useState<"user" | "admin">("user");
   821	  const [remotePairStep, setRemotePairStep] = useState<"idle" | "os" | "install" | "finish">("idle");
   822	  const [remotePairExistingIds, setRemotePairExistingIds] = useState<string[]>([]);
   823	  const [remoteBusy, setRemoteBusy] = useState(false);
   824	  const [remoteClientDeleteTarget, setRemoteClientDeleteTarget] = useState<RemoteClient | null>(null);
   825	  const [voiceApiKey, setVoiceApiKey] = useState("");
   826	  const [voiceKeyBusy, setVoiceKeyBusy] = useState(false);
   827	  const [deleteTarget, setDeleteTarget] = useState<
   828	    { type: "mcp"; item: McpServer } | { type: "provider"; item: ProviderConnection } | null
   829	  >(null);
   830	  const [providerDefinitions, setProviderDefinitions] = useState<ProviderDefinition[]>([]);
   831	  const [providerConnections, setProviderConnections] = useState<ProviderConnection[]>([]);
   832	  const [providersLoaded, setProvidersLoaded] = useState(false);
   833	  const providerLoadVersionRef = useRef(0);
   834	  const [providerDraft, setProviderDraft] = useState({
   835	    id: "",
   836	    providerKey: "openai",
   837	    slug: "openai-main",
   838	    label: "OpenAI",
   839	    authType: "api_key",
   840	    baseUrl: "",
   841	    secret: "",
   842	    project: "",
   843	    location: "",
   844	  });
   845	  const [providerBusy, setProviderBusy] = useState(false);
   846	  const [customModes, setCustomModes] = useState<AgentMode[]>([]);
   847	  const [modeDraft, setModeDraft] = useState<AgentMode>({
   848	    id: "",
   849	    name: "",
   850	    description: "",
   851	    icon: "sliders-horizontal",
   852	    instructions: "",
   853	    allowedCategories: ["read"],
   854	  });
   855	  const [modeOverridesDraft, setModeOverridesDraft] = useState("{}");
   856	  const [oauthFlow, setOauthFlow] = useState<OAuthFlow | null>(null);
   857	  const [oauthCode, setOauthCode] = useState("");
   858	  const [archivedChats, setArchivedChats] = useState<ArchivedChat[]>([]);
   859	  const [sharedChats, setSharedChats] = useState<ArchivedChat[]>([]);
   860	  const [archivedChatsLoaded, setArchivedChatsLoaded] = useState(false);
   861	  const [browserNotificationsAvailable, setBrowserNotificationsAvailable] =
   862	    useState(false);
   863	  const [resetMetisOpen, setResetMetisOpen] = useState(false);
   864	  const [updateMetisOpen, setUpdateMetisOpen] = useState(false);
   865	  const loadRemoteClients = useCallback(async () => {
   866	    try {
   867	      const response = await fetch("/api/remote-clients", { cache: "no-store" });
   868	      if (!response.ok) throw new Error("Failed to load remote clients");
   869	      const data = (await response.json()) as { clients?: RemoteClient[] };
   870	      setRemoteClients(data.clients || []);
   871	    } catch (error) {
   872	      toast.error(error instanceof Error ? error.message : "Failed to load remote clients");
   873	    }
   874	  }, []);
   875	
   876	  const checkDesktopPermissions = useCallback(async (client: RemoteClient, prompt = false) => {
   877	    if (client.status !== "online" || !client.capabilities?.includes("desktop_gui")) return;
   878	    setDesktopStatusBusyId(client.id);
   879	    try {
   880	      const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}/desktop-permissions`, {
   881	        method: "POST",
   882	        headers: { "Content-Type": "application/json" },
   883	        body: JSON.stringify({ prompt }),
   884	      });
   885	      const data = (await response.json()) as { status?: DesktopPermissionStatus; error?: string };
   886	      if (!response.ok || !data.status) throw new Error(data.error || "Desktop permission check failed");
   887	      setDesktopStatusById((current) => ({ ...current, [client.id]: data.status as DesktopPermissionStatus }));
   888	      desktopStatusChecked.current.add(client.id);
   889	      if (prompt) toast.success(data.status.available ? `Desktop control is ready on ${client.name}` : `Permission prompt sent to ${client.name}`);
   890	    } catch (error) {
   891	      desktopStatusChecked.current.delete(client.id);
   892	      toast.error(error instanceof Error ? error.message : "Desktop permission check failed");
   893	    } finally {
   894	      setDesktopStatusBusyId("");
   895	    }
   896	  }, []);
   897	
   898	  const loadGlobalRemoteAllowlist = useCallback(async () => {
   899	    setRemoteGlobalAllowlistLoaded(false);
   900	    setRemoteGlobalAllowlistError("");
   901	    try {
   902	      const response = await fetch("/api/remote-clients/allowlist", { cache: "no-store" });
   903	      const data = (await response.json()) as { allowlist?: string[]; error?: string };
   904	      if (!response.ok) throw new Error(data.error || "Could not load global allowlist");
   905	      setRemoteGlobalAllowlistDraft((data.allowlist || []).join("\n"));
   906	      setRemoteGlobalAllowlistLoaded(true);
   907	    } catch (error) {
   908	      setRemoteGlobalAllowlistError(error instanceof Error ? error.message : "Could not load global allowlist");
   909	    }
   910	  }, []);
   911	
   912	  const saveGlobalRemoteAllowlist = useCallback(async () => {
   913	    setRemoteGlobalAllowlistBusy(true);
   914	    setRemoteGlobalAllowlistError("");
   915	    try {
   916	      const response = await fetch("/api/remote-clients/allowlist", {
   917	        method: "PUT",
   918	        headers: { "Content-Type": "application/json" },
   919	        body: JSON.stringify({ allowlist: remoteGlobalAllowlistDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }),
   920	      });
   921	      const data = (await response.json()) as { allowlist?: string[]; error?: string };
   922	      if (!response.ok) throw new Error(data.error || "Could not save global allowlist");
   923	      setRemoteGlobalAllowlistDraft((data.allowlist || []).join("\n"));
   924	      toast.success("Global command allowlist saved");
   925	    } catch (error) {
   926	      setRemoteGlobalAllowlistError(error instanceof Error ? error.message : "Could not save global allowlist");
   927	    } finally {
   928	      setRemoteGlobalAllowlistBusy(false);
   929	    }
   930	  }, [remoteGlobalAllowlistDraft]);
   931	
   932	  const loadBrowserStorage = useCallback(async () => {
   933	    setBrowserStorageLoading(true);
   934	    setBrowserStorageError("");
   935	    try {
   936	      const response = await fetch("/api/browser/storage", { cache: "no-store" });
   937	      const data = (await response.json()) as { origins?: typeof browserStorage; error?: string };
   938	      if (!response.ok) throw new Error(data.error || "Could not load browser storage");
   939	      setBrowserStorage(data.origins || []);
   940	    } catch (error) {
   941	      setBrowserStorageError(error instanceof Error ? error.message : "Could not load browser storage");
   942	    } finally {
   943	      setBrowserStorageLoading(false);
   944	    }
   945	  }, []);
   946	
   947	  const createBrowserStorage = useCallback(async (origin: string) => {
   948	    if (!browserStorageDraft.name.trim()) return;
   949	    setBrowserStorageSaving(true);
   950	    try {
   951	      const response = await fetch("/api/browser/storage", {
   952	        method: "POST",
   953	        headers: { "Content-Type": "application/json" },
   954	        body: JSON.stringify({ origin, ...browserStorageDraft, name: browserStorageDraft.name.trim() }),
   955	      });
   956	      const data = (await response.json().catch(() => ({}))) as { error?: string };
   957	      if (!response.ok) throw new Error(data.error || "Could not create browser storage entry");
   958	      setBrowserStorageDraft((current) => ({ ...current, name: "", value: "" }));
   959	      toast.success("Storage entry created");
   960	      await loadBrowserStorage();
   961	    } catch (error) {
   962	      toast.error(error instanceof Error ? error.message : "Could not create browser storage entry");
   963	    } finally {
   964	      setBrowserStorageSaving(false);
   965	    }
   966	  }, [browserStorageDraft, loadBrowserStorage]);
   967	
   968	  const clearBrowserStorage = useCallback(async (origin?: string) => {
   969	    const response = await fetch("/api/browser/storage", {
   970	      method: "DELETE",
   971	      headers: { "Content-Type": "application/json" },
   972	      body: JSON.stringify(origin ? { origin } : { all: true }),
   973	    });
   974	    const data = (await response.json().catch(() => ({}))) as { error?: string };
   975	    if (!response.ok) throw new Error(data.error || "Could not clear browser storage");
   976	    toast.success(origin ? `Browser data cleared for ${origin}` : "All browser data cleared");
   977	    await loadBrowserStorage();
   978	  }, [loadBrowserStorage]);
   979	
   980	  useEffect(() => {
   981	   if (!open) {
   982	    setSettingsPane("tab");
   983	    setBrowserStorageQuery("");
   984	    return;
   985	   }
   986	   if (settingsTab === "general" || settingsPane === "browser-storage") {
   987	    void loadBrowserStorage();
   988	   }
   989	  }, [loadBrowserStorage, open, settingsPane, settingsTab]);
   990	
   991	  const createRemoteEnrollment = useCallback(async (platform = remotePlatform) => {
   992	    setRemoteBusy(true);
   993	    setRemotePlatform(platform);
   994	    setRemotePairExistingIds(remoteClients.map((client) => client.id));
   995	    try {
   996	      const response = await fetch("/api/remote-clients", {
   997	        method: "POST",
   998	        headers: { "Content-Type": "application/json" },
   999	        body: JSON.stringify({ os: platform, permissionMode: remotePermissionMode }),
  1000	      });
  1001	      const data = (await response.json()) as { command?: string; commands?: { linux?: string; windows?: string; macos?: string }; token?: string; serverUrl?: string; installerUrl?: string; installerUrls?: Array<{ label: string; url: string }>; error?: string };
  1002	      if (!response.ok || !data.command) throw new Error(data.error || "Failed to create enrollment command");
  1003	      setRemoteCommand(data.command);
  1004	      setRemotePairToken(data.token || "");
  1005	      setRemoteServerUrl(data.serverUrl || "");
  1006	      setRemoteInstallerUrls(data.installerUrls || (platform === "windows" && data.installerUrl ? [{ label: "Windows installer", url: data.installerUrl }] : []));
  1007	      setRemoteCommands({
  1008	        linux: data.commands?.linux || data.command,
  1009	        windows: data.commands?.windows || "",
  1010	        macos: data.commands?.macos || "",
  1011	      });
  1012	      setRemotePairStep("install");
  1013	      if (platform !== "windows" && !data.installerUrls?.length) {
  1014	        await navigator.clipboard?.writeText(data.command);
  1015	        toast.success("Enrollment command copied");
  1016	      }
  1017	    } catch (error) {
  1018	      toast.error(error instanceof Error ? error.message : "Failed to create enrollment command");
  1019	    } finally {
  1020	      setRemoteBusy(false);
  1021	    }
  1022	  }, [remoteClients, remotePermissionMode, remotePlatform]);
  1023	
  1024	  const copyRemoteCommand = useCallback(async () => {
  1025	    const command = remoteCommands?.[remotePlatform] || remoteCommand;
  1026	    try {
  1027	      await navigator.clipboard.writeText(command);
  1028	      toast.success("Install command copied");
  1029	    } catch {
  1030	      toast.error("Could not copy install command");
  1031	    }
  1032	  }, [remoteCommand, remoteCommands, remotePlatform]);
  1033	
  1034	  const testRemoteConnection = useCallback(async (client: RemoteClient) => {
  1035	    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}/test`, { method: "POST" });
  1036	    const data = (await response.json()) as { info?: { hostname?: string; os?: string; uptime?: number }; error?: string };
  1037	    if (!response.ok) {
  1038	      toast.error(data.error || "Connection test failed");
  1039	      return;
  1040	    }
  1041	    toast.success(`${data.info?.hostname || client.name} is connected`);
  1042	    await loadRemoteClients();
  1043	  }, [loadRemoteClients]);
  1044	
  1045	  const updateRemotePolicy = useCallback(async (client: RemoteClient, policy: RemoteClient["policy"]) => {
  1046	    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}`, {
  1047	      method: "PATCH",
  1048	      headers: { "Content-Type": "application/json" },
  1049	      body: JSON.stringify({ policy }),
  1050	    });
  1051	    if (!response.ok) {
  1052	      const data = (await response.json().catch(() => ({}))) as { error?: string };
  1053	      throw new Error(data.error || "Failed to update policy");
  1054	    }
  1055	    await loadRemoteClients();
  1056	  }, [loadRemoteClients]);
  1057	
  1058	  const renameRemoteClient = useCallback(async (client: RemoteClient, name: string) => {
  1059	    const nextName = name.trim();
  1060	    if (!nextName || nextName === client.name) return;
  1061	    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}`, {
  1062	      method: "PATCH",
  1063	      headers: { "Content-Type": "application/json" },
  1064	      body: JSON.stringify({ name: nextName }),
  1065	    });
  1066	    if (!response.ok) toast.error("Failed to rename remote client");
  1067	    else await loadRemoteClients();
  1068	  }, [loadRemoteClients]);
  1069	
  1070	  const revokeRemoteClient = useCallback(async (client: RemoteClient) => {
  1071	    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
  1072	    if (!response.ok) {
  1073	      const data = (await response.json().catch(() => ({}))) as { error?: string };
  1074	      toast.error(data.error || "Failed to revoke client");
  1075	      return;
  1076	    }
  1077	    toast.success("Remote client removed");
  1078	    await loadRemoteClients();
  1079	  }, [loadRemoteClients]);
  1080	
  1081	  useEffect(() => {
  1082	    if (!open || settingsTab !== "devices") return;
  1083	    void loadRemoteClients();
  1084	    void loadGlobalRemoteAllowlist();
  1085	    const timer = window.setInterval(() => void loadRemoteClients(), 2_000);
  1086	    return () => window.clearInterval(timer);
  1087	  }, [loadRemoteClients, loadGlobalRemoteAllowlist, open, settingsTab]);
  1088	  useEffect(() => {
  1089	    if (!open || settingsTab !== "devices") return;
  1090	    for (const client of remoteClients) {
  1091	      if (client.status !== "online" || !client.capabilities?.includes("desktop_gui")) continue;
  1092	      if (desktopStatusChecked.current.has(client.id) || desktopStatusBusyId === client.id) continue;
  1093	      void checkDesktopPermissions(client);
  1094	    }
  1095	  }, [checkDesktopPermissions, desktopStatusBusyId, open, remoteClients, settingsTab]);
  1096	  useEffect(() => {
  1097	    if (remotePairStep !== "install") return;
  1098	    let active = true;
  1099	    const checkForConnection = async () => {
  1100	      try {
  1101	        const response = await fetch("/api/remote-clients", { cache: "no-store" });
  1102	        if (!response.ok) return;
  1103	        const data = (await response.json()) as { clients?: RemoteClient[] };
  1104	        if (!active) return;
  1105	        const clients = data.clients || [];
  1106	        setRemoteClients(clients);
  1107	        const knownIds = new Set(remotePairExistingIds);
  1108	        const connectedClient = clients.find((client) => !knownIds.has(client.id) && client.status === "online");
  1109	        if (connectedClient) {
  1110	          setRemotePairStep("finish");
  1111	          toast.success(`${connectedClient.name} connected`);
  1112	        }
  1113	      } catch {
  1114	        // The normal settings refresh will retry while the modal is open.
  1115	      }
  1116	    };
  1117	    void checkForConnection();
  1118	    const timer = window.setInterval(() => void checkForConnection(), 2_000);
  1119	    return () => {
  1120	      active = false;
  1121	      window.clearInterval(timer);
  1122	    };
  1123	  }, [remotePairExistingIds, remotePairStep]);
  1124	  useEffect(() => {
  1125	    setBrowserNotificationsAvailable(
  1126	      typeof window !== "undefined" && "Notification" in window,
  1127	    );
  1128	  }, []);
  1129	
  1130	  const loadMcpServers = useCallback(async () => {
  1131	    try {
  1132	      const res = await fetch("/api/mcp-servers", { cache: "no-store" });
  1133	      if (!res.ok) throw new Error("Failed to load MCP servers");
  1134	      const data = (await res.json()) as { servers?: McpServer[] };
  1135	      setMcpServers(data.servers || []);
  1136	    } catch (error) {
  1137	      toast.error(error instanceof Error ? error.message : "Failed to load MCP servers");
  1138	    } finally {
  1139	      setMcpLoaded(true);
  1140	    }
  1141	  }, []);
  1142	
  1143	  const loadArchivedChats = useCallback(async () => {
  1144	    setArchivedChatsLoaded(false);
  1145	    try {
  1146	      const res = await fetch("/api/chats?includeArchived=true", { cache: "no-store" });
  1147	      if (!res.ok) throw new Error("Failed to load archived chats");
  1148	      const data = (await res.json()) as { chats?: ArchivedChat[] };
  1149	      const chats = data.chats || [];
  1150	      setArchivedChats(chats.filter((chat) => chat.archived));
  1151	      setSharedChats(chats.filter((chat) => chat.share?.active));
  1152	    } catch (error) {
  1153	      toast.error(error instanceof Error ? error.message : "Failed to load archived chats");
  1154	    } finally {
  1155	      setArchivedChatsLoaded(true);
  1156	    }
  1157	  }, []);
  1158	
  1159	  const loadProviders = useCallback(async () => {
  1160	    const loadVersion = ++providerLoadVersionRef.current;
  1161	    setProvidersLoaded(false);
  1162	    try {
  1163	      const res = await fetch("/api/providers", { cache: "no-store" });
  1164	      if (!res.ok) throw new Error("Failed to load providers");
  1165	      const data = (await res.json()) as {
  1166	        providers?: ProviderDefinition[];
  1167	        connections?: ProviderConnection[];
  1168	      };
  1169	      if (loadVersion !== providerLoadVersionRef.current) return;
  1170	      setProviderDefinitions(data.providers || []);
  1171	      setProviderConnections(data.connections || []);
  1172	      const first = data.providers?.[0];
  1173	      if (first) {
  1174	        setProviderDraft((current) => {
  1175	          if (current.id || data.providers?.some((provider) => provider.key === current.providerKey)) {
  1176	            return current;
  1177	          }
  1178	          return {
  1179	            ...current,
  1180	            providerKey: first.key,
  1181	            authType: preferredAuthType(first),
  1182	            baseUrl: first.defaultBaseUrl || "",
  1183	          };
  1184	        });
  1185	      }
  1186	    } catch (error) {
  1187	      if (loadVersion === providerLoadVersionRef.current) {
  1188	        toast.error(error instanceof Error ? error.message : "Failed to load providers");
  1189	      }
  1190	    } finally {
  1191	      if (loadVersion === providerLoadVersionRef.current) setProvidersLoaded(true);
  1192	    }
  1193	  }, []);
  1194	
  1195	  const loadCustomModes = useCallback(async () => {
  1196	    const response = await fetch("/api/modes", { cache: "no-store" });
  1197	    if (!response.ok) return;
  1198	    const data = (await response.json()) as { modes?: AgentMode[] };
  1199	    setCustomModes((data.modes || []).filter((mode) => !mode.builtIn));
  1200	  }, []);
  1201	
  1202	  useEffect(() => {
  1203	    if (open) {
  1204	      void loadMcpServers();
  1205	      void loadArchivedChats();
  1206	      void loadProviders();
  1207	      void loadCustomModes();
  1208	    }
  1209	  }, [loadArchivedChats, loadCustomModes, loadMcpServers, loadProviders, open]);
  1210	
  1211	  async function updateArchivedChat(id: string, archived: boolean) {
  1212	    const res = await fetch(`/api/chats/${id}`, {
  1213	      method: "PATCH",
  1214	      headers: { "Content-Type": "application/json" },
  1215	      body: JSON.stringify({ archived }),
  1216	    });
  1217	    if (!res.ok) {
  1218	      toast.error("Failed to update chat");
  1219	      return;
  1220	    }
  1221	    await loadArchivedChats();
  1222	    onChatsChanged();
  1223	    toast.success(archived ? "Chat archived" : "Chat restored");
  1224	  }
  1225	
  1226	  async function saveCustomMode() {
  1227	    const payload = {
  1228	      ...modeDraft,
  1229	      id: modeDraft.id || undefined,
  1230	      allowedCategories: modeDraft.allowedCategories,
  1231	      toolOverrides: (() => {
  1232	        try {
  1233	          const parsed = JSON.parse(modeOverridesDraft);
  1234	          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  1235	        } catch {
  1236	          return {};
  1237	        }
  1238	      })(),
  1239	    };
  1240	    const response = await fetch("/api/modes", {
  1241	      method: "POST",
  1242	      headers: { "Content-Type": "application/json" },
  1243	      body: JSON.stringify(payload),
  1244	    });
  1245	    if (!response.ok) {
  1246	      toast.error("Could not save mode");
  1247	      return;
  1248	    }
  1249	    setModeDraft({ id: "", name: "", description: "", icon: "sliders-horizontal", instructions: "", allowedCategories: ["read"] });
  1250	    setModeOverridesDraft("{}");
  1251	    await loadCustomModes();
  1252	    onModesChanged?.();
  1253	    toast.success("Mode saved");
  1254	  }
  1255	
  1256	  async function deleteCustomMode(mode: AgentMode) {
  1257	    await fetch(`/api/modes?id=${encodeURIComponent(mode.id)}`, { method: "DELETE" });
  1258	    await loadCustomModes();
  1259	    onModesChanged?.();
  1260	  }
  1261	
  1262	  async function deleteArchivedChat(id: string) {
  1263	    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  1264	    if (!res.ok) {
  1265	      toast.error("Failed to delete chat");
  1266	      return;
  1267	    }
  1268	    await loadArchivedChats();
  1269	    onChatsChanged();
  1270	    toast.success("Chat deleted");
  1271	  }
  1272	
  1273	  async function deactivateShare(chat: ArchivedChat) {
  1274	    const res = await fetch(`/api/chats/${chat.id}/share`, { method: "DELETE" });
  1275	    if (!res.ok) {
  1276	      toast.error("Failed to deactivate share");
  1277	      return;
  1278	    }
  1279	    await loadArchivedChats();
  1280	    onChatsChanged();
  1281	    toast.success("Share link deactivated");
  1282	  }
  1283	
  1284	  async function addMemory() {
  1285	    const content = draft.trim();
  1286	    if (!content || busy) return;
  1287	    setBusy(true);
  1288	    try {
  1289	      const res = await fetch("/api/memories", {
  1290	        method: "POST",
  1291	        headers: { "Content-Type": "application/json" },
  1292	        body: JSON.stringify({ content }),
  1293	      });
  1294	      if (!res.ok) {
  1295	        const err = await res.json().catch(() => ({}));
  1296	        throw new Error(
  1297	          (err as { error?: string }).error || "Could not add rule",
  1298	        );
  1299	      }
  1300	      setDraft("");
  1301	      onMemoriesChanged();
  1302	      toast.success("Rule saved");
  1303	    } catch (e) {
  1304	      toast.error(e instanceof Error ? e.message : "Could not add rule");
  1305	    } finally {
  1306	      setBusy(false);
  1307	    }
  1308	  }
  1309	
  1310	  async function removeMemory(id: string) {
  1311	    if (deletingMemoryIds.has(id)) return;
  1312	    setDeletingMemoryIds((current) => new Set(current).add(id));
  1313	    try {
  1314	      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
  1315	      if (!res.ok) throw new Error("Failed to delete");
  1316	      onMemoryDeleted(id);
  1317	      toast.success("Rule deleted");
  1318	    } catch {
  1319	      toast.error("Could not delete rule");
  1320	    } finally {
  1321	      setDeletingMemoryIds((current) => {
  1322	        const next = new Set(current);
  1323	        next.delete(id);
  1324	        return next;
  1325	      });
  1326	    }
  1327	  }
  1328	
  1329	  function parseLines(value: string) {
  1330	    const entries: Record<string, string> = {};
  1331	    for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  1332	      const separator = line.indexOf("=");
  1333	      if (separator <= 0) throw new Error("Environment and header lines must use NAME=value");
  1334	      const key = line.slice(0, separator).trim();
  1335	      const item = line.slice(separator + 1);
  1336	      if (!/^[A-Za-z_][A-Za-z0-9-]*$/.test(key)) throw new Error(`Invalid key: ${key}`);
  1337	      entries[key] = item;
  1338	    }
  1339	    return entries;
  1340	  }
  1341	
  1342	  async function saveMcpServer() {
  1343	    if (mcpBusy) return;
  1344	    setMcpBusy(true);
  1345	    try {
  1346	      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(mcpDraft.id)) {
  1347	        throw new Error("ID must use 2-64 lowercase characters, numbers, dots, underscores, or hyphens");
  1348	      }
  1349	      if (!mcpDraft.name.trim()) throw new Error("Name is required");
  1350	      if (mcpDraft.kind === "remote" && !mcpDraft.url.trim()) throw new Error("URL is required");
  1351	      if (mcpDraft.kind === "stdio" && !mcpDraft.command.trim()) throw new Error("Command is required");
  1352	      const env = parseLines(mcpDraft.env);
  1353	      const headers = parseLines(mcpDraft.headers);
  1354	      const body = {
  1355	        id: mcpDraft.id.trim(),
  1356	        name: mcpDraft.name.trim(),
  1357	        kind: mcpDraft.kind,
  1358	        ...(mcpDraft.url.trim() ? { url: mcpDraft.url.trim() } : {}),
  1359	        ...(mcpDraft.command.trim() ? { command: mcpDraft.command.trim() } : {}),
  1360	        ...(mcpDraft.args.trim() ? { args: mcpDraft.args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : {}),
  1361	        ...(Object.keys(env).length ? { env } : {}),
  1362	        ...(Object.keys(headers).length ? { headers } : {}),
  1363	      };
  1364	      const res = await fetch("/api/mcp-servers", {
  1365	        method: "POST",
  1366	        headers: { "Content-Type": "application/json" },
  1367	        body: JSON.stringify(body),
  1368	      });
  1369	      const data = (await res.json().catch(() => ({}))) as { error?: string };
  1370	      if (!res.ok) throw new Error(data.error || "Failed to save MCP server");
  1371	      setMcpDraft(emptyMcpDraft);
  1372	      await loadMcpServers();
  1373	      toast.success("MCP server saved");
  1374	    } catch (error) {
  1375	      toast.error(error instanceof Error ? error.message : "Failed to save MCP server");
  1376	    } finally {
  1377	      setMcpBusy(false);
  1378	    }
  1379	  }
  1380	
  1381	  function editMcpServer(server: McpServer) {
  1382	    setMcpDraft({
  1383	      id: server.id,
  1384	      name: server.name,
  1385	      kind: server.kind,
  1386	      url: server.url || "",
  1387	      command: server.command || "",
  1388	      args: server.args?.join("\n") || "",
  1389	      env: "",
  1390	      headers: "",
  1391	    });
  1392	  }
  1393	
  1394	  async function toggleMcpServer(server: McpServer) {
  1395	    const res = await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, {
  1396	      method: "PATCH",
  1397	      headers: { "Content-Type": "application/json" },
  1398	      body: JSON.stringify({ enabled: !server.enabled }),
  1399	    });
  1400	    if (!res.ok) {
  1401	      toast.error("Failed to update MCP server");
  1402	      return;
  1403	    }
  1404	    await loadMcpServers();
  1405	  }
  1406	
  1407	  async function deleteMcpServer(server: McpServer) {
  1408	    const res = await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
  1409	    if (!res.ok) {
  1410	      toast.error("Failed to delete MCP server");
  1411	      return;
  1412	    }
  1413	    await loadMcpServers();
  1414	    if (mcpDraft.id === server.id) setMcpDraft(emptyMcpDraft);
  1415	    toast.success("MCP server deleted");
  1416	  }
  1417	
  1418	  function selectProvider(providerKey: string) {
  1419	    const definition = providerDefinitions.find((provider) => provider.key === providerKey);
  1420	    setProviderDraft((current) => ({
  1421	      ...current,
  1422	      providerKey,
  1423	      authType: definition ? preferredAuthType(definition) : "api_key",
  1424	      baseUrl: definition?.defaultBaseUrl || "",
  1425	      slug: current.id ? current.slug : `${providerKey}-main`,
  1426	      label: current.id ? current.label : definition?.name || providerKey,
  1427	      secret: "",
  1428	      project: "",
  1429	      location: "",
  1430	    }));
  1431	  }
  1432	
  1433	  function editProviderConnection(connection: ProviderConnection) {
  1434	    const definition = providerDefinitions.find((provider) => provider.key === connection.providerKey);
  1435	    setProviderDraft({
  1436	      id: connection.id,
  1437	      providerKey: connection.providerKey,
  1438	      slug: connection.slug,
  1439	      label: connection.label,
  1440	      authType: connection.authType,
  1441	      baseUrl: connection.baseUrl || "",
  1442	      secret: "",
  1443	      project: typeof connection.config?.project === "string" ? connection.config.project : "",
  1444	      location: typeof connection.config?.location === "string" ? connection.config.location : "",
  1445	    });
  1446	    onSettingsTabChange("models");
  1447	    setSettingsPane("providers");
  1448	    requestAnimationFrame(() => {
  1449	      document.getElementById("provider-connection-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  1450	    });
  1451	  }
  1452	
  1453	  async function saveProviderConnection() {
  1454	    if (providerBusy) return;
  1455	    setProviderBusy(true);
  1456	    try {
  1457	      const editableConfig =
  1458	        providerDraft.authType === "vertex_adc" ||
  1459	        (providerDraft.providerKey === "antigravity" && providerDraft.authType === "oauth")
  1460	          ? {
  1461	              ...(providerDraft.project.trim() ? { project: providerDraft.project.trim() } : {}),
  1462	              ...(providerDraft.authType === "vertex_adc" && providerDraft.location.trim()
  1463	                ? { location: providerDraft.location.trim() }
  1464	                : {}),
  1465	            }
  1466	          : undefined;
  1467	      const body: Record<string, unknown> = providerDraft.id
  1468	        ? {
  1469	            label: providerDraft.label.trim(),
  1470	            ...(providerDraft.authType !== "oauth" ? { baseUrl: providerDraft.baseUrl.trim() } : {}),
  1471	            ...(providerDraft.secret ? { secret: providerDraft.secret } : {}),
  1472	            ...(editableConfig ? { config: editableConfig } : {}),
  1473	          }
  1474	        : {
  1475	            providerKey: providerDraft.providerKey,
  1476	            slug: providerDraft.slug.trim(),
  1477	            label: providerDraft.label.trim(),
  1478	            authType: providerDraft.authType,
  1479	            ...(providerDraft.baseUrl.trim() ? { baseUrl: providerDraft.baseUrl.trim() } : {}),
  1480	            ...(providerDraft.secret ? { secret: providerDraft.secret } : {}),
  1481	            ...(editableConfig ? { config: editableConfig } : {}),
  1482	          };
  1483	      const res = await fetch(
  1484	        providerDraft.id ? `/api/providers/${encodeURIComponent(providerDraft.id)}` : "/api/providers",
  1485	        {
  1486	          method: providerDraft.id ? "PATCH" : "POST",
  1487	          headers: { "Content-Type": "application/json" },
  1488	          body: JSON.stringify(body),
  1489	        },
  1490	      );
  1491	      const data = (await res.json().catch(() => ({}))) as {
  1492	        connection?: ProviderConnection;
  1493	        error?: string;
  1494	      };
  1495	      if (!res.ok) throw new Error(data.error || "Failed to save provider connection");
  1496	      await loadProviders();
  1497	      onModelsChanged?.();
  1498	      const definition = providerDefinitions.find((provider) => provider.key === providerDraft.providerKey);
  1499	      setProviderDraft((current) => ({
  1500	        id: "",
  1501	        providerKey: current.providerKey,
  1502	        slug: `${current.providerKey}-main`,
  1503	        label: definition?.name || current.providerKey,
  1504	        authType: current.authType,
  1505	        baseUrl: current.authType === "vertex_adc" ? "" : definition?.defaultBaseUrl || "",
  1506	        secret: "",
  1507	        project: "",
  1508	        location: "",
  1509	      }));
  1510	      toast.success("Provider connection saved");
  1511	    } catch (error) {
  1512	      toast.error(error instanceof Error ? error.message : "Failed to save provider connection");
  1513	    } finally {
  1514	      setProviderBusy(false);
  1515	    }
  1516	  }
  1517	
  1518	  async function connectProviderOAuth() {
  1519	    if (providerBusy) return;
  1520	    setProviderBusy(true);
  1521	    setOauthFlow(null);
  1522	    setOauthCode("");
  1523	    let openedAuthUrl = false;
  1524	    try {
  1525	      const res = await fetch("/api/providers/oauth/start", {
  1526	        method: "POST",
  1527	        headers: { "Content-Type": "application/json" },
  1528	        body: JSON.stringify({
  1529	          providerKey: providerDraft.providerKey,
  1530	          slug: providerDraft.slug.trim(),
  1531	          label: providerDraft.label.trim(),
  1532	          ...(providerDraft.providerKey === "antigravity" && providerDraft.project.trim()
  1533	            ? { config: { project: providerDraft.project.trim() } }
  1534	            : {}),
  1535	        }),
  1536	      });
  1537	      const data = (await res.json().catch(() => ({}))) as {
  1538	        flow?: OAuthFlow;
  1539	        error?: string;
  1540	      };
  1541	      if (!res.ok || !data.flow) throw new Error(data.error || "Failed to start OAuth login");
  1542	      setOauthFlow(data.flow);
  1543	
  1544	      for (let attempt = 0; attempt < 600; attempt += 1) {
  1545	        const statusRes = await fetch(
  1546	          `/api/providers/oauth/status?flowId=${encodeURIComponent(data.flow.id)}`,
  1547	          { cache: "no-store" },
  1548	        );
  1549	        const statusData = (await statusRes.json().catch(() => ({}))) as {
  1550	          flow?: OAuthFlow;
  1551	          error?: string;
  1552	        };
  1553	        if (!statusRes.ok || !statusData.flow) {
  1554	          throw new Error(statusData.error || "Failed to read OAuth status");
  1555	        }
  1556	        const nextFlow = statusData.flow;
  1557	        setOauthFlow(nextFlow);
  1558	        if (nextFlow.authUrl && !openedAuthUrl) {
  1559	          openedAuthUrl = true;
  1560	          const popup = window.open(nextFlow.authUrl, "_blank", "noopener,noreferrer");
  1561	          if (!popup) toast.info("Open the OAuth link shown below to continue.");
  1562	        }
  1563	        if (["completed", "error", "cancelled"].includes(nextFlow.status)) {
  1564	          if (nextFlow.status === "completed") {
  1565	            await loadProviders();
  1566	            onModelsChanged?.();
  1567	            setProviderDraft((current) => ({
  1568	              ...current,
  1569	              id: "",
  1570	              slug: `${current.providerKey}-main`,
  1571	              secret: "",
  1572	              project: "",
  1573	              location: "",
  1574	            }));
  1575	            toast.success("OAuth connection completed");
  1576	          } else if (nextFlow.error) {
  1577	            toast.error(nextFlow.error);
  1578	          }
  1579	          return;
  1580	        }
  1581	        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  1582	      }
  1583	      throw new Error("OAuth login timed out.");
  1584	    } catch (error) {
  1585	      toast.error(error instanceof Error ? error.message : "OAuth login failed");
  1586	    } finally {
  1587	      setProviderBusy(false);
  1588	    }
  1589	  }
  1590	
  1591	  async function submitOAuthCode() {
  1592	    if (!oauthFlow || !oauthCode.trim()) return;
  1593	    const res = await fetch("/api/providers/oauth/input", {
  1594	      method: "POST",
  1595	      headers: { "Content-Type": "application/json" },
  1596	      body: JSON.stringify({ flowId: oauthFlow.id, code: oauthCode.trim() }),
  1597	    });
  1598	    const data = (await res.json().catch(() => ({}))) as { error?: string };
  1599	    if (!res.ok) {
  1600	      toast.error(data.error || "Failed to submit OAuth code");
  1601	      return;
  1602	    }
  1603	    setOauthCode("");
  1604	    toast.success("OAuth code submitted");
  1605	  }
  1606	
  1607	  async function toggleProviderConnection(connection: ProviderConnection) {
  1608	    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}`, {
  1609	      method: "PATCH",
  1610	      headers: { "Content-Type": "application/json" },
  1611	      body: JSON.stringify({ enabled: !connection.enabled }),
  1612	    });
  1613	    if (!res.ok) {
  1614	      toast.error("Failed to update provider connection");
  1615	      return;
  1616	    }
  1617	    await loadProviders();
  1618	    onModelsChanged?.();
  1619	  }
  1620	
  1621	  async function testProviderConnection(connection: ProviderConnection) {
  1622	    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/test`, { method: "POST" });
  1623	    const data = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
  1624	    if (!res.ok) {
  1625	      toast.error(data.error || "Provider connection failed");
  1626	      await loadProviders();
  1627	      onModelsChanged?.();
  1628	      return;
  1629	    }
  1630	    toast.success(data.detail || "Provider connection is ready");
  1631	    await loadProviders();
  1632	    onModelsChanged?.();
  1633	  }
  1634	
  1635	  async function discoverProviderModels(connection: ProviderConnection) {
  1636	    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/discover`, { method: "POST" });
  1637	    const data = (await res.json().catch(() => ({}))) as { models?: unknown[]; error?: string };
  1638	    if (!res.ok) {
  1639	      toast.error(data.error || "Model discovery failed");
  1640	      return;
  1641	    }
  1642	    toast.success(`${data.models?.length || 0} models discovered`);
  1643	    await loadProviders();
  1644	    onModelsChanged?.();
  1645	  }
  1646	
  1647	  async function deleteProviderConnection(connection: ProviderConnection) {
  1648	    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}`, { method: "DELETE" });
  1649	    const data = (await res.json().catch(() => ({}))) as { error?: string };
  1650	    if (!res.ok) {
  1651	      toast.error(data.error || "Failed to delete provider connection");
  1652	      return;
  1653	    }
  1654	
  1655	    // Remove it from the visible settings state immediately. A slower, older
  1656	    // providers request must not be able to resurrect a connection that was
  1657	    // already deleted.
  1658	    providerLoadVersionRef.current += 1;
  1659	    setProviderConnections((current) => current.filter((item) => item.id !== connection.id));
  1660	    if (providerDraft.id === connection.id) {
  1661	      const definition = providerDefinitions.find((provider) => provider.key === connection.providerKey);
  1662	      setProviderDraft((current) => ({
  1663	        ...current,
  1664	        id: "",
  1665	        slug: `${connection.providerKey}-main`,
  1666	        label: definition?.name || connection.providerKey,
  1667	        authType: definition ? preferredAuthType(definition) : current.authType,
  1668	        baseUrl: definition?.defaultBaseUrl || "",
  1669	        secret: "",
  1670	        project: "",
  1671	        location: "",
  1672	      }));
  1673	    }
  1674	    onModelsChanged?.();
  1675	    void onRefreshUsage();
  1676	    await loadProviders();
  1677	    toast.success("Provider connection deleted");
  1678	  }
  1679	
  1680	  async function toggleNotifications() {
  1681	    if (notificationsEnabled) {
  1682	      onNotificationsEnabledChange(false);
  1683	      return;
  1684	    }
  1685	    if (typeof window === "undefined" || !("Notification" in window)) return;
  1686	    if (Notification.permission === "default") {
  1687	      const permission = await Notification.requestPermission();
  1688	      if (permission !== "granted") {
  1689	        toast.warning(
  1690	          permission === "denied"
  1691	            ? "Browser notifications are blocked."
  1692	            : "Browser notification permission was not granted.",
  1693	        );
  1694	        return;
  1695	      }
  1696	    } else if (Notification.permission !== "granted") {
  1697	      toast.warning("Browser notifications are blocked.");
  1698	      return;
  1699	    }
  1700	    onNotificationsEnabledChange(true);
  1701	  }
  1702	
  1703	  function handleFinishSoundUpload(event: ChangeEvent<HTMLInputElement>) {
  1704	    const file = event.target.files?.[0];
  1705	    event.target.value = "";
  1706	    if (!file) return;
  1707	    if (!file.type.startsWith("audio/")) {
  1708	      toast.error("Please choose an audio file.");
  1709	      return;
  1710	    }
  1711	    if (file.size > 5 * 1024 * 1024) {
  1712	      toast.error("Custom sounds must be 5 MB or smaller.");
  1713	      return;
  1714	    }
  1715	    const reader = new FileReader();
  1716	    reader.onload = () => {
  1717	      if (typeof reader.result !== "string") return;
  1718	      onFinishSoundChange({ name: file.name, dataUrl: reader.result });
  1719	      toast.success("Custom finish sound saved");
  1720	    };
  1721	    reader.onerror = () => toast.error("Could not read the audio file.");
  1722	    reader.readAsDataURL(file);
  1723	  }
  1724	
  1725	  const filteredBrowserStorage = browserStorage.filter((item) => {
  1726	   const query = String(browserStorageQuery ?? "").trim().toLowerCase();
  1727	   if (!query) return true;
  1728	   return String(item.origin ?? "").toLowerCase().includes(query) || item.storageTypes.some((type) => String(type ?? "").toLowerCase().includes(query));
  1729	  });
  1730	
  1731	  const selectableProviders = providerDefinitions;
  1732	  const sortedProviderConnections = [...providerConnections].sort((a, b) => {
  1733	    const aName = providerDefinitions.find((provider) => provider.key === a.providerKey)?.name || a.providerKey;
  1734	    const bName = providerDefinitions.find((provider) => provider.key === b.providerKey)?.name || b.providerKey;
  1735	    return `${aName} ${a.label}`.localeCompare(`${bName} ${b.label}`);
  1736	  });
  1737	
  1738	  return (
  1739	    <>
  1740	      <Dialog open={open} onOpenChange={onOpenChange}>
  1741	      <DialogContent className="flex h-[min(58rem,calc(100dvh-1rem))] min-w-[min(42rem,calc(100vw-1rem))] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
  1742	        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14 sm:px-8">
  1743	          <DialogTitle className="flex items-center gap-2 text-base">
  1744	            <Settings2 className="size-4 text-primary" />
  1745	            Settings
  1746	          </DialogTitle>
  1747	          <DialogDescription className="text-xs sm:text-sm">
  1748	            Manage your workspace in one place.
  1749	          </DialogDescription>
  1750	        </DialogHeader>
  1751	
  1752	        <Tabs value={settingsTab} onValueChange={(tab) => { setSettingsPane("tab"); setBrowserStorageQuery(""); onSettingsTabChange(tab); }} className="min-h-0 flex-1 gap-0 md:grid md:items-stretch md:grid-cols-[13rem_minmax(0,1fr)]">
  1753	          <UpdateStatusProbe isHostAdmin={Boolean(isHostAdmin)} onUpdateAvailableChange={setUpdateAvailable} />
  1754	          <div className="border-b border-border bg-muted/20 p-3 md:hidden">
  1755	            <CustomSelect
  1756	              value={settingsTab}
  1757	              onValueChange={(tab) => { setSettingsPane("tab"); setBrowserStorageQuery(""); onSettingsTabChange(tab); }}
  1758	              ariaLabel="Settings section"
  1759	              className="h-10 w-full"
  1760	              options={[
  1761	                { value: "general", label: "General" },
  1762	                { value: "models", label: "Models" },
  1763	                { value: "agent", label: "Agent" },
  1764	 { value: "devices", label: "Devices" },
  1765	 { value: "admin", label: isHostAdmin ? "Admin" : "Chats" },
  1766	 { value: "updates", label: updateAvailable ? "Update Available" : "Updates" },
  1767	              ]}
  1768	            />
  1769	          </div>
  1770	          <TabsList className="hidden h-auto w-full shrink-0 flex-wrap justify-start gap-1.5 rounded-none border-b border-border bg-muted/20 px-3 py-3 md:flex md:h-full md:min-h-0 md:flex-nowrap md:flex-col md:items-stretch md:justify-start md:overflow-y-auto md:border-b-0 md:border-r md:px-3 md:py-4">
  1771	           {SETTINGS_TABS.map((tab) => {
  1772	           const Icon =
  1773	           tab.value === "general" ? Settings2
  1774	           : tab.value === "models" ? KeyRound
  1775	           : tab.value === "agent" ? Puzzle
  1776	           : tab.value === "devices" ? PlugZap
  1777	           : tab.value === "updates" ? RefreshCw
  1778	           : Users;
  1779	           const label = tab.value === "updates" && updateAvailable
  1780	             ? "Update Available"
  1781	             : tab.value === "admin" ? (isHostAdmin ? "Admin" : "Chats") : tab.label;
  1782	           const expanded = settingsTab === tab.value;
  1783	           return (
  1784	           <Fragment key={tab.value}>
  1785	           <TabsTrigger
  1786	             value={tab.value}
  1787	             className={cn(
  1788	               "min-h-10 w-full justify-start px-2.5 py-2.5 pl-4 has-data-[icon=inline-start]:pl-4 md:h-auto md:flex-none",
  1789	               tab.value === "updates" && updateAvailable && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  1790	             )}
  1791	           >
  1792	           <Icon data-icon="inline-start" />
  1793	           {label}
  1794	           </TabsTrigger>
  1795	           {expanded
  1796	           ? visibleSettingsSections(tab.value, isHostAdmin).map((item) => (
  1797	           <button
  1798	            key={item.id}
  1799	            type="button"
  1800	            className={cn(
  1801	            "ml-2 hidden w-[calc(100%-0.5rem)] truncate rounded-md border-l border-border/40 py-1 pl-4 pr-2.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground md:block",
  1802	            SETTINGS_SECTION_TO_PANE[item.id] === settingsPane && "bg-muted/60 text-foreground",
  1803	            )}
  1804	            onClick={() => {
  1805	            const pane = SETTINGS_SECTION_TO_PANE[item.id];
  1806	            if (pane) {
  1807	            setSettingsPane(pane);
  1808	            return;
  1809	            }
  1810	            setSettingsPane("tab");
  1811	            scrollSettingsSection(item.id);
  1812	            }}
  1813	            >
  1814	           {item.label}
  1815	           </button>
  1816	           ))
  1817	           : null}
  1818	           </Fragment>
  1819	           );
  1820	           })}
  1821	          </TabsList>
  1822	
  1823	          <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
  1824	 {settingsPane === "browser-storage" ? (
  1825	 <div
  1826	 className="flex h-full min-h-0 flex-col gap-5 px-6 py-6 sm:px-8 sm:py-8"
  1827	 data-slot="browser-storage-manager"
  1828	 >
  1829	 <button
  1830	 type="button"
  1831	 className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
  1832	 onClick={() => setSettingsPane("tab")}
  1833	 >
  1834	 <ArrowLeft className="size-3.5" />
  1835	 Back to General
  1836	 </button>
  1837	 <div className="flex items-start justify-between gap-3">
  1838	 <div>
  1839	 <h3 className="text-sm font-medium">Browser storage</h3>
  1840	 <p className="mt-1 text-xs text-muted-foreground">
  1841	 Persistent website sessions are stored privately for your account. Search the list and clear individual origins without scrolling General.
  1842	 </p>
  1843	 </div>
  1844	 <Button type="button" variant="destructive" size="sm" onClick={() => setBrowserStorageClearAll(true)} disabled={!browserStorage.length}>
  1845	 Clear all
  1846	 </Button>
  1847	 </div>
  1848	 <Input
  1849	 value={browserStorageQuery}
  1850	 onChange={(event) => setBrowserStorageQuery(event.target.value)}
  1851	 placeholder="Search websites"
  1852	 aria-label="Search stored websites"
  1853	 />
  1854	 {browserStorageLoading ? <p className="text-xs text-muted-foreground">Loading stored websites…</p> : null}
  1855	 {browserStorageError ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{browserStorageError}</p> : null}
  1856	 {!browserStorageLoading && !browserStorageError && !browserStorage.length ? (
  1857	 <p className="rounded-md border border-border/60 p-4 text-xs text-muted-foreground">No persistent website data stored yet.</p>
  1858	 ) : null}
  1859	 {!browserStorageLoading && !browserStorageError && browserStorage.length > 0 && filteredBrowserStorage.length === 0 ? (
  1860	 <p className="rounded-md border border-border/60 p-4 text-xs text-muted-foreground">No websites match that search.</p>
  1861	 ) : null}
  1862	 <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
  1863	 {filteredBrowserStorage.map((item) => {
  1864	   const expanded = expandedBrowserOrigin === item.origin;
  1865	   return (
  1866	   <div key={item.origin} className="rounded-md border border-border/60">
  1867	     <div className="flex items-center gap-3 p-3">
  1868	       <button
  1869	         type="button"
  1870	         className="flex min-w-0 flex-1 items-start gap-2 text-left"
  1871	         aria-expanded={expanded}
  1872	         onClick={() => setExpandedBrowserOrigin(expanded ? null : item.origin)}
  1873	       >
  1874	         <ChevronDown className={cn("mt-0.5 size-4 shrink-0 transition-transform", !expanded && "-rotate-90")} />
  1875	         <span className="min-w-0">
  1876	           <span className="block truncate text-sm">{item.origin}</span>
  1877	           <span className="mt-1 block text-[11px] text-muted-foreground">
  1878	             {item.storageTypes.join(" · ")} · {item.sizeBytes.toLocaleString()} bytes
  1879	           </span>
  1880	         </span>
  1881	       </button>
  1882	       <Button type="button" variant="outline" size="sm" onClick={() => setBrowserStorageDeleteTarget(item.origin)}>
  1883	         Clear
  1884	       </Button>
  1885	     </div>
  1886	     {expanded ? (
  1887	       <div className="space-y-4 border-t border-border/60 bg-muted/10 p-3">
  1888	         <div className="space-y-2">
  1889	           <p className="text-xs font-medium">Cookies</p>
  1890	           {item.cookies.length ? item.cookies.map((cookie) => (
  1891	             <div key={`${cookie.domain}:${cookie.path}:${cookie.name}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
  1892	               <span className="font-medium">{cookie.name}</span>
  1893	               <span className="text-muted-foreground">{cookie.domain}{cookie.path} · {cookie.size} bytes</span>
  1894	             </div>
  1895	           )) : <p className="text-xs text-muted-foreground">No cookies.</p>}
  1896	         </div>
  1897	         {(["localStorage", "sessionStorage"] as const).map((storageType) => (
  1898	           <div key={storageType} className="space-y-2">
  1899	             <p className="text-xs font-medium">{storageType}</p>
  1900	             {item[storageType].length ? item[storageType].map((entry) => (
  1901	               <div key={entry.key} className="grid gap-1 text-xs sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)]">
  1902	                 <span className="font-medium break-all">{entry.key}</span>
  1903	                 <span className="break-all text-muted-foreground">{entry.value}</span>
  1904	               </div>
  1905	             )) : <p className="text-xs text-muted-foreground">No entries available for an open page.</p>}
  1906	           </div>
  1907	         ))}
  1908	         <form className="space-y-2 border-t border-border/60 pt-3" onSubmit={(event) => { event.preventDefault(); void createBrowserStorage(item.origin); }}>
  1909	           <p className="text-xs font-medium">Add entry</p>
  1910	           <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
  1911	             <select
  1912	               value={browserStorageDraft.type}
  1913	               onChange={(event) => setBrowserStorageDraft((current) => ({ ...current, type: event.target.value as typeof current.type }))}
  1914	               className="h-9 rounded-md border border-input bg-background px-3 text-sm"
  1915	               aria-label="Storage entry type"
  1916	             >
  1917	               <option value="cookie">Cookie</option>
  1918	               <option value="localStorage">localStorage</option>
  1919	               <option value="sessionStorage">sessionStorage</option>
  1920	             </select>
  1921	             <Input value={browserStorageDraft.name} onChange={(event) => setBrowserStorageDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Name or key" aria-label="Storage entry name" />
  1922	           </div>
  1923	           <Input value={browserStorageDraft.value} onChange={(event) => setBrowserStorageDraft((current) => ({ ...current, value: event.target.value }))} placeholder="Value" aria-label="Storage entry value" />
  1924	           <Button type="submit" size="sm" disabled={browserStorageSaving || !browserStorageDraft.name.trim()}>
  1925	             {browserStorageSaving ? "Adding…" : "Add entry"}
  1926	           </Button>
  1927	         </form>
  1928	       </div>
  1929	     ) : null}
  1930	   </div>
  1931	   );
  1932	 })}
  1933	 </div>
  1934	 </div>
  1935	 ) : settingsPane === "providers" ? (
  1936	 <SettingsFeaturePane
  1937	 backLabel="Models"
  1938	 slot="providers-manager"
  1939	 onBack={() => setSettingsPane("tab")}
  1940	 >
  1941	<section className="flex flex-col gap-4">
  1942	                <div>
  1943	                  <h3 id="settings-providers" className="text-sm font-medium">AI providers and connections</h3>
  1944	                  <p className="mt-1 text-xs text-muted-foreground">
  1945	                    Credentials are stored encrypted on the server and are never returned to the browser.
  1946	                    Configure API keys, OAuth, SDK, CLI, and local connections together in one list.
  1947	                  </p>
  1948	                </div>
  1949	                <div id="provider-connection-form" className={`space-y-3 rounded-xl border p-4 ${providerDraft.id ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/20"}`}>
  1950	                  {providerDraft.id ? (
  1951	                    <div className="flex flex-wrap items-center justify-between gap-2">
  1952	                      <p className="text-xs font-medium text-primary">
  1953	                        Editing existing connection · {providerDraft.id.slice(0, 8)}…
  1954	                      </p>
  1955	                      <Button
  1956	                        type="button"
  1957	                        size="xs"
  1958	                        variant="ghost"
  1959	                        onClick={() => setProviderDraft((current) => ({
  1960	                          ...current,
  1961	                          id: "",
  1962	                          slug: `${current.providerKey}-main`,
  1963	                          label: providerDefinitions.find((provider) => provider.key === current.providerKey)?.name || current.label,
  1964	                          secret: "",
  1965	                        }))}
  1966	                      >
  1967	                        New connection instead
  1968	                      </Button>
  1969	                    </div>
  1970	                  ) : null}
  1971	                  <div className="grid gap-2 sm:grid-cols-2">
  1972	                  <CustomSelect
  1973	                    value={providerDraft.providerKey}
  1974	                    onValueChange={selectProvider}
  1975	                    ariaLabel="Provider"
  1976	                    disabled={Boolean(providerDraft.id)}
  1977	                    className="w-full"
  1978	                    options={selectableProviders.map((provider) => ({
  1979	                      value: provider.key,
  1980	                      label: provider.name,
  1981	                      providerLogo: provider.key,
  1982	                    }))}
  1983	                  />
  1984	                  <CustomSelect
  1985	                    value={providerDraft.authType}
  1986	                    onValueChange={(authType) => setProviderDraft((current) => ({ ...current, authType }))}
  1987	                    ariaLabel="Authentication method"
  1988	                    disabled={Boolean(providerDraft.id)}
  1989	                    className="w-full"
  1990	                    options={(providerDefinitions.find((provider) => provider.key === providerDraft.providerKey)?.authTypes || ["api_key"]).map((authType) => ({
  1991	                      value: authType,
  1992	                      label: authType === "api_key"
  1993	                        ? (providerDraft.providerKey === "antigravity" ? "Gemini API key (SDK)" : "API key")
  1994	                        : authType === "oauth"
  1995	                          ? (providerDraft.providerKey === "antigravity" ? "OAuth (agy CLI)" : "OAuth")
  1996	                          : authType === "vertex_adc"
  1997	                            ? "Google Vertex / ADC"
  1998	                            : authType === "account"
  1999	                              ? "Official account credentials"
  2000	                              : authType === "local" ? "CLI on this machine" : "Local endpoint",
  2001	                    }))}
  2002	                  />
  2003	                  <Input
  2004	                    value={providerDraft.slug}
  2005	                    onChange={(event) => setProviderDraft((current) => ({ ...current, slug: event.target.value }))}
  2006	                    placeholder="connection-id"
  2007	                    aria-label="Connection ID"
  2008	                    disabled={Boolean(providerDraft.id)}
  2009	                  />
  2010	                  <Input
  2011	                    value={providerDraft.label}
  2012	                    onChange={(event) => setProviderDraft((current) => ({ ...current, label: event.target.value }))}
  2013	                    placeholder="Connection name"
  2014	                    aria-label="Connection name"
  2015	                  />
  2016	                </div>
  2017	                {providerDraft.authType === "vertex_adc" ||
  2018	                (providerDraft.providerKey === "antigravity" && providerDraft.authType === "oauth") ? (
  2019	                  <div className="grid gap-2 sm:grid-cols-2">
  2020	                    <Input
  2021	                      value={providerDraft.project}
  2022	                      onChange={(event) => setProviderDraft((current) => ({ ...current, project: event.target.value }))}
  2023	                      placeholder={providerDraft.authType === "oauth" ? "Optional GCP project (workspace accounts need this)" : "GCP project"}
  2024	                      aria-label="GCP project"
  2025	                    />
  2026	                    <Input
  2027	                      value={providerDraft.location}
  2028	                      onChange={(event) => setProviderDraft((current) => ({ ...current, location: event.target.value }))}
  2029	                      placeholder="us-central1"
  2030	                      aria-label="GCP location"
  2031	                    />
  2032	                  </div>
  2033	                ) : providerDraft.providerKey !== "cursor" &&
  2034	        providerDraft.providerKey !== "grok-build" &&
  2035	        providerDraft.providerKey !== "opencode" &&
  2036	        providerDraft.authType !== "oauth" &&
  2037	        providerDraft.authType !== "local" ? (
  2038	                  <Input
  2039	                    value={providerDraft.baseUrl}
  2040	                    onChange={(event) => setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))}
  2041	                    placeholder="https://api.example.com/v1"
  2042	                    aria-label="Provider base URL"
  2043	                  />
  2044	                ) : null}
  2045	                {providerDraft.authType !== "local" &&
  2046	                providerDraft.authType !== "vertex_adc" &&
  2047	                providerDraft.authType !== "oauth" ? (
  2048	                  <Input
  2049	                    type="password"
  2050	                    value={providerDraft.secret}
  2051	                    onChange={(event) => setProviderDraft((current) => ({ ...current, secret: event.target.value }))}
  2052	                    placeholder={providerDraft.authType === "account" ? "Paste official auth.json content" : "Secret is write-only"}
  2053	                    aria-label="Provider credential"
  2054	                    autoComplete="new-password"
  2055	                  />
  2056	                ) : null}
  2057	                {providerDraft.authType === "api_key" && API_KEY_URLS[providerDraft.providerKey] ? (
  2058	                  <a
  2059	                    href={API_KEY_URLS[providerDraft.providerKey]}
  2060	                    target="_blank"
  2061	                    rel="noreferrer"
  2062	                    className="text-xs text-primary underline underline-offset-2"
  2063	                  >
  2064	                    Get {providerDefinitions.find((provider) => provider.key === providerDraft.providerKey)?.name || "provider"} API key
  2065	                  </a>
  2066	                ) : null}
  2067	                {providerDefinitions.find((provider) => provider.key === providerDraft.providerKey)?.setupHint ? (
  2068	                  <p className="text-xs text-muted-foreground">
  2069	                    {providerDefinitions.find((provider) => provider.key === providerDraft.providerKey)?.setupHint}
  2070	                  </p>
  2071	                ) : null}
  2072	                <div className="flex flex-wrap gap-2">
  2073	                {providerDraft.authType === "oauth" ? (
  2074	                  <>
  2075	                    {providerDraft.id ? (
  2076	                      <Button type="button" onClick={() => void saveProviderConnection()} disabled={providerBusy || !providersLoaded || !providerDraft.label.trim()}>
  2077	                        {providerBusy ? "Saving…" : "Save changes"}
  2078	                      </Button>
  2079	                    ) : null}
  2080	                    <Button type="button" variant={providerDraft.id ? "outline" : "default"} onClick={() => void connectProviderOAuth()} disabled={providerBusy || !providersLoaded}>
  2081	                      {providerBusy ? "Connecting…" : providerDraft.id ? "Reconnect OAuth" : "Connect via OAuth"}
  2082	                    </Button>
  2083	                  </>
  2084	                ) : (
  2085	                    <Button type="button" onClick={() => void saveProviderConnection()} disabled={providerBusy || !providersLoaded || !providerDraft.label.trim()}>
  2086	                      {providerBusy ? "Saving…" : providerDraft.id ? "Update connection" : "Save connection"}
  2087	                    </Button>
  2088	                  )}
  2089	                  <Button
  2090	                    type="button"
  2091	                    variant="ghost"
  2092	                    onClick={() => setProviderDraft((current) => ({
  2093	                      ...current,
  2094	                      id: "",
  2095	                      slug: `${current.providerKey}-main`,
  2096	                      label: providerDefinitions.find((provider) => provider.key === current.providerKey)?.name || current.label,
  2097	                      secret: "",
  2098	                    }))}
  2099	                  >
  2100	                    Clear
  2101	                  </Button>
  2102	                </div>
  2103	                </div>
  2104	                {oauthFlow ? (
  2105	                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
  2106	                    <div>
  2107	                      <p className="text-sm font-medium">
  2108	                        OAuth: {oauthFlow.status}
  2109	                      </p>
  2110	                      {oauthFlow.instructions ? (
  2111	                        <p className="mt-1 text-xs text-muted-foreground">
  2112	                          {oauthFlow.instructions}
  2113	                        </p>
  2114	                      ) : null}
  2115	                    </div>
  2116	                    {oauthFlow.authUrl ? (
  2117	                      <a
  2118	                        href={oauthFlow.authUrl}
  2119	                        target="_blank"
  2120	                        rel="noreferrer"
  2121	                        className="block break-all text-xs text-primary underline underline-offset-2"
  2122	                      >
  2123	                        Open OAuth authorization link
  2124	                      </a>
  2125	                    ) : null}
  2126	                    {oauthFlow.userCode ? (
  2127	                      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
  2128	                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
  2129	                          Device code
  2130	                        </p>
  2131	                        <p className="mt-1 select-all font-mono text-xl font-semibold tracking-[0.18em] text-foreground">
  2132	                          {oauthFlow.userCode}
  2133	                        </p>
  2134	                      </div>
  2135	                    ) : null}
  2136	                    {oauthFlow.manualInputRequired ? (
  2137	                      <div className="flex gap-2">
  2138	                        <Input
  2139	                          value={oauthCode}
  2140	                          onChange={(event) => setOauthCode(event.target.value)}
  2141	                          placeholder="Code or complete callback URL"
  2142	                          aria-label="OAuth code or callback URL"
  2143	                        />
  2144	                        <Button type="button" onClick={() => void submitOAuthCode()} disabled={!oauthCode.trim()}>
  2145	                          Submit
  2146	                        </Button>
  2147	                      </div>
  2148	                    ) : null}
  2149	                    {oauthFlow.providerKey === "claude-code" ? (
  2150	                      <p className="text-xs text-amber-400">
  2151	                        Claude OAuth is an experimental personal-use flow and may conflict with Anthropic's current third-party usage restrictions.
  2152	                      </p>
  2153	                    ) : null}
  2154	                    {oauthFlow.providerKey === "antigravity" ? (
  2155	                      <p className="text-xs text-amber-400">
  2156	                        Antigravity OAuth uses the official agy CLI remote-login flow and stores its token profile per connection.
  2157	                      </p>
  2158	                    ) : null}
  2159	                    {oauthFlow.error ? (
  2160	                      <p className="text-xs text-red-400">{oauthFlow.error}</p>
  2161	                    ) : null}
  2162	                  </div>
  2163	                ) : null}
  2164	                {!providersLoaded ? (
  2165	                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
  2166	                    Loading provider connections…
  2167	                  </div>
  2168	                ) : providerConnections.length === 0 ? (
  2169	                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
  2170	                    No provider connections configured yet.
  2171	                  </div>
  2172	                ) : (
  2173	                  <ul className="flex flex-col gap-2">
  2174	                    {sortedProviderConnections.map((connection) => {
  2175	                      const definition = providerDefinitions.find((provider) => provider.key === connection.providerKey);
  2176	                      return (
  2177	                        <li key={connection.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
  2178	                          <ProviderLogo providerId={connection.providerKey} className="size-5" />
  2179	                          <div className="min-w-0 flex-1">
  2180	                            <p className="truncate text-sm font-medium">
  2181	                              {connection.label}
  2182	                              <span className="ml-2 text-xs font-normal text-muted-foreground">{definition?.name || connection.providerKey}</span>
  2183	                            </p>
  2184	                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
  2185	                              {connection.slug} · {connection.authType} · {connection.enabled ? "enabled" : "disabled"}
  2186	                              {connection.hasSecret ? " · credential set" : ""}
  2187	                            </p>
  2188	                            {connection.lastError ? <p className="mt-1 text-xs text-red-400">{connection.lastError}</p> : null}
  2189	                          </div>
  2190	                          <Button type="button" size="sm" variant={connection.enabled ? "outline" : "default"} onClick={() => void toggleProviderConnection(connection)}>
  2191	                            {connection.enabled ? "Disable" : "Enable"}
  2192	                          </Button>
  2193	                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Test ${connection.label}`} onClick={() => void testProviderConnection(connection)}><PlugZap className="size-3.5" /></Button>
  2194	                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Refresh models for ${connection.label}`} onClick={() => void discoverProviderModels(connection)}><RefreshCw className="size-3.5" /></Button>
  2195	                          <Button type="button" size="sm" variant="ghost" onClick={() => editProviderConnection(connection)}>Edit</Button>
  2196	                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Delete ${connection.label}`} onClick={() => setDeleteTarget({ type: "provider", item: connection })}><Trash2 className="size-3.5" /></Button>
  2197	                        </li>
  2198	                      );
  2199	                    })}
  2200	                  </ul>
  2201	                )}
  2202	              </section>
  2203	 </SettingsFeaturePane>
  2204	 ) : settingsPane === "versions" ? (
  2205	 <SettingsFeaturePane
  2206	 backLabel="Models"
  2207	 title="CLI versions"
  2208	 description="Installed agent CLI and SDK versions on this server."
  2209	 slot="versions-manager"
  2210	 onBack={() => setSettingsPane("tab")}
  2211	 >
  2212	 <CliVersionsPanel isHostAdmin={Boolean(isHostAdmin)} />
  2213	 </SettingsFeaturePane>
  2214	 ) : settingsPane === "skills" ? (
  2215	 <SettingsFeaturePane
  2216	 backLabel="Agent"
  2217	 title="Skills"
  2218	 description="Installed skills from skills-lock.json, plus skills you add for this account. Open a skill to change Always on. Enabled skills stay available; Always on injects the skill into every chat."
  2219	 slot="skills-manager"
  2220	 onBack={() => setSettingsPane("tab")}
  2221	 >
  2222	 <SkillsSettings hideHeading />
  2223	 </SettingsFeaturePane>
  2224	 ) : settingsPane === "modes" ? (
  2225	 <SettingsFeaturePane
  2226	 backLabel="Agent"
  2227	 slot="modes-manager"
  2228	 onBack={() => setSettingsPane("tab")}
  2229	 >
  2230	<section className="flex flex-col gap-4">
  2231	                <div>
  2232	                  <h3 id="settings-modes" className="text-sm font-medium">Agent modes</h3>
  2233	                  <p className="mt-1 text-xs text-muted-foreground">Create reusable modes with custom instructions and server-enforced tool permissions.</p>
  2234	                </div>
  2235	                <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
  2236	                  <div className="grid gap-2 sm:grid-cols-2">
  2237	                    <Input value={modeDraft.name} onChange={(event) => setModeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Mode name" aria-label="Mode name" />
  2238	                    <Input value={modeDraft.icon} onChange={(event) => setModeDraft((current) => ({ ...current, icon: event.target.value }))} placeholder="Icon name" aria-label="Mode icon" />
  2239	                  </div>
  2240	                  <Input value={modeDraft.description} onChange={(event) => setModeDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Short description" aria-label="Mode description" />
  2241	                  <Textarea value={modeDraft.instructions} onChange={(event) => setModeDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder="Custom instructions for this mode" aria-label="Mode instructions" />
  2242	                  <div className="flex flex-wrap gap-1.5">
  2243	                    {TOOL_PERMISSION_CATEGORIES.map((category) => {
  2244	                      const active = modeDraft.allowedCategories.includes(category);
  2245	                      return <Button key={category} type="button" size="xs" variant={active ? "default" : "outline"} onClick={() => setModeDraft((current) => ({ ...current, allowedCategories: active ? current.allowedCategories.filter((item) => item !== category) : [...current.allowedCategories, category as ToolPermissionCategory] }))}>{category}</Button>;
  2246	                    })}
  2247	                  </div>
  2248	                  <Textarea value={modeOverridesDraft} onChange={(event) => setModeOverridesDraft(event.target.value)} placeholder='{"write_file": false}' aria-label="Individual tool overrides" className="min-h-16 font-mono text-xs" />
  2249	                  <p className="text-[11px] text-muted-foreground">Optional individual overrides as JSON, for example {"{"}"write_file": false{"}"}</p>
  2250	                  <div className="flex justify-end">
  2251	                    <Button type="button" onClick={() => void saveCustomMode()} disabled={!modeDraft.name.trim()}>Save mode</Button>
  2252	                  </div>
  2253	                </div>
  2254	                {customModes.length ? (
  2255	                  <div className="divide-y rounded-xl border">
  2256	                    {customModes.map((mode) => (
  2257	                      <div key={mode.id} className="flex items-center gap-3 px-3 py-2.5">
  2258	                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{mode.name}</p><p className="truncate text-xs text-muted-foreground">{mode.description || "Custom mode"}</p></div>
  2259	                        <Button type="button" size="xs" variant="ghost" onClick={() => { setModeDraft(mode); setModeOverridesDraft(JSON.stringify(mode.toolOverrides || {}, null, 2)); }}>Edit</Button>
  2260	                        <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => void deleteCustomMode(mode)}>Delete</Button>
  2261	                      </div>
  2262	                    ))}
  2263	                  </div>
  2264	                ) : null}
  2265	              </section>
  2266	
  2267	               </SettingsFeaturePane>
  2268	 ) : settingsPane === "mcp" ? (
  2269	 <SettingsFeaturePane
  2270	 backLabel="Agent"
  2271	 slot="mcp-manager"
  2272	 onBack={() => setSettingsPane("tab")}
  2273	 >
  2274	<section className="flex flex-col gap-4">
  2275	                <div>
  2276	                  <h3 id="settings-mcp" className="text-sm font-medium">Custom MCP servers</h3>
  2277	                  <p className="mt-1 text-xs text-muted-foreground">
  2278	                    Each account can add its own remote HTTP or local stdio MCP servers. They are not shared with other users. Secret values are write-only.
  2279	                  </p>
  2280	                </div>
  2281	                <div className="grid gap-2 sm:grid-cols-2">
  2282	                  <Input
  2283	                    value={mcpDraft.id}
  2284	                    onChange={(e) => setMcpDraft((current) => ({ ...current, id: e.target.value }))}
  2285	                    placeholder="server-id"
  2286	                    aria-label="MCP server ID"
  2287	                  />
  2288	                  <Input
  2289	                    value={mcpDraft.name}
  2290	                    onChange={(e) => setMcpDraft((current) => ({ ...current, name: e.target.value }))}
  2291	                    placeholder="Display name"
  2292	                    aria-label="MCP server name"
  2293	                  />
  2294	                </div>
  2295	                <div className="flex gap-2">
  2296	                  <Button
  2297	                    type="button"
  2298	                    variant={mcpDraft.kind === "remote" ? "default" : "outline"}
  2299	                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "remote" }))}
  2300	                  >
  2301	                    Remote HTTP
  2302	                  </Button>
  2303	                  <Button
  2304	                    type="button"
  2305	                    variant={mcpDraft.kind === "stdio" ? "default" : "outline"}
  2306	                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "stdio" }))}
  2307	                  >
  2308	                    Local stdio
  2309	                  </Button>
  2310	                </div>
  2311	                {mcpDraft.kind === "remote" ? (
  2312	                  <Input
  2313	                    value={mcpDraft.url}
  2314	                    onChange={(e) => setMcpDraft((current) => ({ ...current, url: e.target.value }))}
  2315	                    placeholder="https://example.com/mcp"
  2316	                    aria-label="MCP server URL"
  2317	                  />
  2318	                ) : (
  2319	                  <>
  2320	                    <Input
  2321	                      value={mcpDraft.command}
  2322	                      onChange={(e) => setMcpDraft((current) => ({ ...current, command: e.target.value }))}
  2323	                      placeholder="npx"
  2324	                      aria-label="MCP command"
  2325	                    />
  2326	                    <Textarea
  2327	                      value={mcpDraft.args}
  2328	                      onChange={(e) => setMcpDraft((current) => ({ ...current, args: e.target.value }))}
  2329	                      placeholder={"One argument per line\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed-directory"}
  2330	                      aria-label="MCP arguments"
  2331	                      rows={4}
  2332	                    />
  2333	                  </>
  2334	                )}
  2335	                <div className="grid gap-3 sm:grid-cols-2">
  2336	                  <Textarea
  2337	                    value={mcpDraft.env}
  2338	                    onChange={(e) => setMcpDraft((current) => ({ ...current, env: e.target.value }))}
  2339	                    placeholder={"Environment (NAME=value)\nAPI_KEY=..."}
  2340	                    aria-label="MCP environment"
  2341	                    rows={4}
  2342	                  />
  2343	                  <Textarea
  2344	                    value={mcpDraft.headers}
  2345	                    onChange={(e) => setMcpDraft((current) => ({ ...current, headers: e.target.value }))}
  2346	                    placeholder={"Headers (NAME=value)\nAuthorization=Bearer ..."}
  2347	                    aria-label="MCP headers"
  2348	                    rows={4}
  2349	                  />
  2350	                </div>
  2351	                <div className="flex gap-2">
  2352	                  <Button type="button" onClick={() => void saveMcpServer()} disabled={mcpBusy}>
  2353	                    {mcpBusy ? "Saving…" : "Save server"}
  2354	                  </Button>
  2355	                  <Button type="button" variant="ghost" onClick={() => setMcpDraft(emptyMcpDraft)}>
  2356	                    Clear
  2357	                  </Button>
  2358	                </div>
  2359	                <ul className="flex flex-col gap-2">
  2360	                  {!mcpLoaded ? (
  2361	                    [0, 1, 2].map((item) => (
  2362	                      <li key={item} className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3" aria-label="Loading MCP servers" role="status">
  2363	                        <Skeleton className="h-4 w-2/5" />
  2364	                        <Skeleton className="h-3 w-3/5" />
  2365	                      </li>
  2366	                    ))
  2367	                  ) : mcpServers.map((server) => (
  2368	                    <li key={server.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 p-3">
  2369	                      <div className="min-w-0 flex-1">
  2370	                        <p className="truncate text-sm font-medium">{server.name}</p>
  2371	                        <p className="truncate text-xs text-muted-foreground">
  2372	                          {server.id} · {server.kind} · {server.enabled ? "enabled" : "disabled"}
  2373	                        </p>
  2374	                        {(server.configured_env_keys?.length || server.configured_header_keys?.length) ? (
  2375	                          <p className="mt-1 text-xs text-muted-foreground">
  2376	                            Secrets configured: {[...(server.configured_env_keys || []), ...(server.configured_header_keys || [])].join(", ")}
  2377	                          </p>
  2378	                        ) : null}
  2379	                      </div>
  2380	                      <Button type="button" size="sm" variant="outline" onClick={() => void toggleMcpServer(server)}>
  2381	                        {server.enabled ? "Disable" : "Enable"}
  2382	                      </Button>
  2383	                      <Button type="button" size="sm" variant="ghost" onClick={() => editMcpServer(server)}>
  2384	                        Edit
  2385	                      </Button>
  2386	                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => setDeleteTarget({ type: "mcp", item: server })} aria-label={`Delete ${server.name}`}>
  2387	                        <Trash2 className="size-3.5" />
  2388	                      </Button>
  2389	                    </li>
  2390	                  ))}
  2391	                </ul>
  2392	              </section>
  2393	
  2394	               </SettingsFeaturePane>
  2395	 ) : settingsPane === "memories" ? (
  2396	 <SettingsFeaturePane
  2397	 backLabel="Agent"
  2398	 slot="memories-manager"
  2399	 onBack={() => setSettingsPane("tab")}
  2400	 >
  2401	<section className="flex flex-col gap-3">
  2402	                <div>
  2403	                  <h3 id="settings-memories" className="text-sm font-medium">Agent Rules</h3>
  2404	                  <p className="mt-1 text-xs text-muted-foreground">
  2405	                    Relevant rules and context are retrieved when they can help with a request. Useful information may be saved automatically.
  2406	                  </p>
  2407	                </div>
  2408	                <div className="flex gap-2">
  2409	                  <Input
  2410	                    value={draft}
  2411	                    onChange={(e) => setDraft(e.target.value)}
  2412	                    placeholder="Add an agent rule…"
  2413	                    onKeyDown={(e) => {
  2414	                      if (e.key === "Enter") {
  2415	                        e.preventDefault();
  2416	                        void addMemory();
  2417	                      }
  2418	                    }}
  2419	                  />
  2420	                  <Button
  2421	                    size="icon"
  2422	                    onClick={() => void addMemory()}
  2423	                    disabled={busy || !draft.trim()}
  2424	                    aria-label="Add rule"
  2425	                  >
  2426	                    <Plus className="size-4" />
  2427	                  </Button>
  2428	                </div>
  2429	                <ul className="flex flex-col gap-2">
  2430	                  {memories.length === 0 ? (
  2431	                    <li className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
  2432	                      No agent rules yet.
  2433	                    </li>
  2434	                  ) : (
  2435	                    memories.map((m) => (
  2436	                      <li
  2437	                        key={m.id}
  2438	                        className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
  2439	                      >
  2440	                        <div className="min-w-0 flex-1">
  2441	                          <p className="text-sm whitespace-pre-wrap">
  2442	                            {m.content}
  2443	                          </p>
  2444	                          {m.tags && m.tags.length > 0 ? (
  2445	                            <p className="mt-1 text-xs text-muted-foreground">
  2446	                              {m.tags.join(" · ")}
  2447	                            </p>
  2448	                          ) : null}
  2449	                        </div>
  2450	                        <Button
  2451	                          variant="ghost"
  2452	                          size="icon-sm"
  2453	                          className="opacity-100 sm:opacity-60 sm:group-hover:opacity-100"
  2454	                          onClick={() => void removeMemory(m.id)}
  2455	                          disabled={deletingMemoryIds.has(m.id)}
  2456	                          aria-label="Delete rule"
  2457	                        >
  2458	                          <Trash2 className="size-3.5" />
  2459	                        </Button>
  2460	                      </li>
  2461	                    ))
  2462	                  )}
  2463	                </ul>
  2464	              </section>
  2465	 </SettingsFeaturePane>
  2466	 ) : settingsPane === "response-instructions" ? (
  2467	   <SettingsFeaturePane
  2468	     backLabel="Agent"
  2469	     title="Response instructions"
  2470	     description="Give the agent instructions for how it should respond across your chats."
  2471	     slot="response-instructions"
  2472	     onBack={() => setSettingsPane("tab")}
  2473	   >
  2474	     <section className="flex max-w-3xl flex-col gap-4">
  2475	       <div>
  2476	         <label htmlFor="response-instructions-input" className="text-xs font-medium">How should the agent respond?</label>
  2477	         <p className="mt-1 text-xs text-muted-foreground">These instructions guide the agent’s tone, level of detail, and formatting. They are separate from Agent Rules, which store useful facts and context.</p>
  2478	       </div>
  2479	       <Textarea
  2480	         id="response-instructions-input"
  2481	         value={responseInstructions}
  2482	         onChange={(event) => { setResponseInstructions(event.target.value); setResponseInstructionsSaved(false); }}
  2483	         disabled={!responseInstructionsLoaded || responseInstructionsBusy}
  2484	         placeholder="For example: Keep answers concise, explain technical terms, and give commands I can copy and paste."
  2485	         rows={10}
  2486	         maxLength={20_000}
  2487	         aria-label="How should the agent respond?"
  2488	         className="min-h-56 resize-y text-sm"
  2489	       />
  2490	       <div className="flex flex-wrap items-center gap-3">
  2491	         <Button type="button" size="sm" onClick={() => void saveResponseInstructions()} disabled={!responseInstructionsLoaded || responseInstructionsBusy}>
  2492	           {responseInstructionsBusy ? "Saving…" : "Save instructions"}
  2493	         </Button>
  2494	         <span className="text-xs text-muted-foreground">{responseInstructions.length.toLocaleString()} / 20,000 characters</span>
  2495	         {responseInstructionsSaved ? <span role="status" className="text-xs text-muted-foreground">Saved. Applies to future replies.</span> : null}
  2496	       </div>
  2497	       {!responseInstructionsLoaded && !responseInstructionsError ? <p role="status" className="text-xs text-muted-foreground">Loading response instructions…</p> : null}
  2498	       {responseInstructionsError ? (
  2499	         <div className="flex flex-wrap items-center gap-3">
  2500	           <p role="alert" className="text-xs text-destructive">{responseInstructionsError}</p>
  2501	           {!responseInstructionsLoaded ? null : <Button type="button" size="sm" variant="outline" onClick={() => setResponseInstructionsReload((value) => value + 1)}>Retry</Button>}
  2502	         </div>
  2503	       ) : null}
  2504	     </section>
  2505	   </SettingsFeaturePane>
  2506	 ) : (
  2507	 <>
  2508	<TabsContent value="updates" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
  2509	  <UpdateSettingsPanel
  2510	    isHostAdmin={Boolean(isHostAdmin)}
  2511	    onUpdateAvailableChange={setUpdateAvailable}
  2512	  />
  2513	</TabsContent>
  2514	
  2515	<TabsContent value="general" className="mt-0 space-y-10 px-6 py-6 sm:px-8 sm:py-8">
  2516	
  2517	 <section className="flex flex-col gap-4">
  2518	                  <h3 id="settings-subagent-model" className="text-sm font-medium">Subagent model</h3>
  2519	                  <p className="mt-1 text-xs text-muted-foreground">
  2520	                    Optionally use one model for delegated subagents. When disabled, the agent chooses the model.
  2521	                  </p>
  2522	                  <div className="mt-3 flex items-center justify-between gap-4">
  2523	                    <p className="text-xs text-muted-foreground">Use a standard model</p>
  2524	                    <Button
  2525	                      type="button"
  2526	                      variant={subagentModelEnabled ? "default" : "outline"}
  2527	                      aria-pressed={subagentModelEnabled}
  2528	                      onClick={() => onSubagentModelEnabledChange(!subagentModelEnabled)}
  2529	                      className="shrink-0"
  2530	                    >
  2531	                      {subagentModelEnabled ? "On" : "Off"}
  2532	                    </Button>
  2533	                  </div>
  2534	                  <div className="mt-3 flex min-w-0 items-center gap-1">
  2535	                    <ModelPicker
  2536	                      models={models}
  2537	                      value={subagentModelId}
  2538	                      onValueChange={onSubagentModelIdChange}
  2539	                      favoriteModelKeys={favoriteModelKeys}
  2540	                      onToggleFavorite={onToggleFavoriteModel}
  2541	                      disabled={!subagentModelEnabled}
  2542	                      className="min-w-0 flex-1"
  2543	                    />
  2544	                    {models.find((model) => model.id === subagentModelId) ? (
  2545	                      <ModelOptionsMenu
  2546	                        model={models.find((model) => model.id === subagentModelId)!}
  2547	                        modelParams={subagentModelParams}
  2548	                        onModelParamsChange={onSubagentModelParamsChange}
  2549	                        className="opacity-100"
  2550	                      />
  2551	                    ) : null}
  2552	                  </div>
  2553	 </section>
  2554	
  2555	              <section className="flex flex-col gap-5">
  2556	                <div>
  2557	                  <h3 id="settings-token-compression" className="text-sm font-medium">Token compression</h3>
  2558	                  <p className="mt-1 text-xs text-muted-foreground">
  2559	                    Reduce noisy tool output and redundant context before it reaches the model.
  2560	                  </p>
  2561	                </div>
  2562	                <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
  2563	                  <div>
  2564	                    <p className="text-sm font-medium">Enable compression</p>
  2565	                    <p className="mt-1 text-xs text-muted-foreground">Disabled by default and isolated per user.</p>
  2566	                  </div>
  2567	                  <Button
  2568	                    type="button"
  2569	                    size="sm"
  2570	                    variant={compressionEnabled ? "default" : "outline"}
  2571	                    aria-pressed={compressionEnabled}
  2572	                    onClick={() => onCompressionSettingsChange({ enabled: !compressionEnabled })}
  2573	                  >
  2574	                    {compressionEnabled ? "On" : "Off"}
  2575	                  </Button>
  2576	                </div>
  2577	                <label className="flex flex-col gap-2 text-xs font-medium">
  2578	                  Mode
  2579	                  <select
  2580	                    value={compressionMode}
  2581	                    disabled={!compressionEnabled}
  2582	                    onChange={(event) => onCompressionSettingsChange({ mode: event.target.value as typeof compressionMode })}
  2583	                    className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal"
  2584	                  >
  2585	                    <option value="lite">Lite — low risk cleanup</option>
  2586	                    <option value="standard">Standard — prose condensation</option>
  2587	                    <option value="aggressive">Aggressive — stronger compression</option>
  2588	                    <option value="rtk">RTK — terminal and tool output</option>
  2589	                    <option value="stacked">Stacked — RTK + Caveman (recommended)</option>
  2590	                    <option value="ultra">Ultra — maximum context recovery</option>
  2591	                  </select>
  2592	                </label>
  2593	                <div className="grid gap-2 sm:grid-cols-2">
  2594	                  <Button type="button" variant={compressionToolResults ? "secondary" : "outline"} disabled={!compressionEnabled} onClick={() => onCompressionSettingsChange({ compressToolResults: !compressionToolResults })}>
  2595	                    Tool results: {compressionToolResults ? "On" : "Off"}
  2596	                  </Button>
  2597	                  <Button type="button" variant={compressionChatHistory ? "secondary" : "outline"} disabled={!compressionEnabled} onClick={() => onCompressionSettingsChange({ compressChatHistory: !compressionChatHistory })}>
  2598	                    Chat history: {compressionChatHistory ? "On" : "Off"}
  2599	                  </Button>
  2600	                </div>
  2601	                <div className="space-y-3 rounded-lg border border-border/60 p-4">
  2602	                  <div>
  2603	                    <p className="text-sm font-medium">Preview</p>
  2604	                    <p className="mt-1 text-xs text-muted-foreground">The sample is sent only for this preview and is never stored.</p>
  2605	                  </div>
  2606	                  <Textarea value={compressionPreview} onChange={(event) => setCompressionPreview(event.target.value)} placeholder="Paste a terminal log or verbose context sample…" rows={6} />
  2607	                  <Button
  2608	                    type="button"
  2609	                    size="sm"
  2610	                    disabled={!compressionPreview.trim() || compressionPreviewBusy}
  2611	                    onClick={async () => {
  2612	                      setCompressionPreviewBusy(true);
  2613	                      try {
  2614	                        const response = await fetch("/api/compression/preview", {
  2615	                          method: "POST",
  2616	                          headers: { "Content-Type": "application/json" },
  2617	                          body: JSON.stringify({ text: compressionPreview, mode: compressionMode }),
  2618	                        });
  2619	                        const data = await response.json() as typeof compressionPreviewResult & { error?: string };
  2620	                        if (!response.ok) throw new Error(data.error || "Preview failed");
  2621	                        setCompressionPreviewResult(data);
  2622	                      } catch (error) {
  2623	                        toast.error(error instanceof Error ? error.message : "Preview failed");
  2624	                      } finally {
  2625	                        setCompressionPreviewBusy(false);
  2626	                      }
  2627	                    }}
  2628	                  >
  2629	                    {compressionPreviewBusy ? "Analyzing…" : "Analyze preview"}
  2630	                  </Button>
  2631	                  {compressionPreviewResult ? (
  2632	                    <div className="rounded-md bg-muted/40 p-3 text-xs">
  2633	                      <p>{compressionPreviewResult.inputChars} → {compressionPreviewResult.outputChars} characters ({compressionPreviewResult.savingsPercent}% reduced)</p>
  2634	                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">{compressionPreviewResult.text}</pre>
  2635	                    </div>
  2636	                  ) : null}
  2637	                </div>
  2638	                <p className="text-xs text-muted-foreground">
  2639	                  Aggressive and ultra modes can remove wording. Code blocks, URLs, paths and structured data are protected where possible.
  2640	                </p>
  2641	              </section>
  2642	
  2643	              <section className="flex flex-col gap-4">
  2644	                <div>
  2645	                  <h3 id="settings-notifications" className="text-sm font-medium">Notifications</h3>
  2646	                  <p className="mt-1 text-xs text-muted-foreground">
  2647	                    Get notified when the agent needs input or finishes a
  2648	                    response.
  2649	                  </p>
  2650	                </div>
  2651	                {browserNotificationsAvailable ? (
  2652	                  <>
  2653	                    <div className="flex items-center justify-between gap-4">
  2654	                      <p className="text-xs text-muted-foreground">
  2655	                        Browser notifications
  2656	                      </p>
  2657	                      <Button
  2658	                        type="button"
  2659	                        variant={notificationsEnabled ? "default" : "outline"}
  2660	                        aria-pressed={notificationsEnabled}
  2661	                        onClick={() => void toggleNotifications()}
  2662	                        className="shrink-0"
  2663	                      >
  2664	                        {notificationsEnabled ? "On" : "Off"}
  2665	                      </Button>
  2666	                    </div>
  2667	                    {Notification.permission === "denied" ? (
  2668	                      <p className="text-xs text-amber-400">
  2669	                        Notifications are blocked in this browser.
  2670	                      </p>
  2671	                    ) : null}
  2672	                  </>
  2673	                ) : (
  2674	                  <p className="text-xs text-muted-foreground">
  2675	                    Browser notifications are unavailable.
  2676	                  </p>
  2677	                )}
  2678	                <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
  2679	                  <div>
  2680	                    <p className="text-xs text-muted-foreground">Sound cues</p>
  2681	                    <p className="mt-1 text-xs text-muted-foreground/70">
  2682	                      Play a sound when an agent finishes.
  2683	                    </p>
  2684	                  </div>
  2685	                  <Button
  2686	                    type="button"
  2687	                    variant={soundCuesEnabled ? "default" : "outline"}
  2688	                    aria-pressed={soundCuesEnabled}
  2689	                    onClick={() => onSoundCuesEnabledChange(!soundCuesEnabled)}
  2690	                    className="shrink-0"
  2691	                  >
  2692	                    {soundCuesEnabled ? "On" : "Off"}
  2693	                  </Button>
  2694	                </div>
  2695	                <div className="flex flex-wrap items-center gap-2">
  2696	                  <Input
  2697	                    type="file"
  2698	                    accept="audio/*"
  2699	                    onChange={handleFinishSoundUpload}
  2700	                    aria-label="Upload custom finish sound"
  2701	                    className="min-w-0 flex-1"
  2702	                  />
  2703	                  <Button
  2704	                    type="button"
  2705	                    variant="outline"
  2706	                    onClick={onTestFinishSound}
  2707	                    disabled={!soundCuesEnabled}
  2708	                  >
  2709	                    Test sound
  2710	                  </Button>
  2711	                  {finishSound ? (
  2712	                    <Button
  2713	                      type="button"
  2714	                      variant="ghost"
  2715	                      onClick={() => onFinishSoundChange(null)}
  2716	                    >
  2717	                      Remove custom sound
  2718	                    </Button>
  2719	                  ) : null}
  2720	                </div>
  2721	                <p className="text-xs text-muted-foreground">
  2722	                  {finishSound
  2723	                    ? `Custom sound: ${finishSound.name}`
  2724	                    : "No custom sound uploaded. The default completion sound plays when sound cues are on. Removing a custom file restores that default."}
  2725	                </p>
  2726	 </section>
  2727	
  2728	              <section className="flex flex-col gap-4">
  2729	                <div>
  2730	                  <h3 id="settings-voice-input" className="text-sm font-medium">Voice input</h3>
  2731	                  <p className="mt-1 text-xs text-muted-foreground">
  2732	                    Choose how speech is transcribed before it is inserted into the composer.
  2733	                  </p>
  2734	                </div>
  2735	                <div className="grid gap-3 sm:grid-cols-2">
  2736	                  <label className="grid gap-1 text-xs text-muted-foreground">
  2737	                    Provider
  2738	                    <select
  2739	                      value={voiceProvider}
  2740	                      onChange={(event) => onVoiceInputSettingsChange({
  2741	                        provider: event.target.value as "openai" | "local" | "custom" | "browser",
  2742	                        ...(event.target.value === "browser" ? { realtime: true } : {}),
  2743	                      })}
  2744	                      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
  2745	                    >
  2746	                      <option value="openai">OpenAI</option>
  2747	                      <option value="local">Local</option>
  2748	                      <option value="browser">Browser transcription</option>
  2749	                      <option value="custom">Custom endpoint</option>
  2750	                    </select>
  2751	                  </label>
  2752	                  <label className="grid gap-1 text-xs text-muted-foreground">
  2753	                    Model ID
  2754	                    <Input
  2755	                      value={voiceModelId}
  2756	                      onChange={(event) => onVoiceInputSettingsChange({ modelId: event.target.value })}
  2757	                      placeholder={voiceProvider === "openai" ? "whisper-1" : "model id"}
  2758	                    />
  2759	                  </label>
  2760	                </div>
  2761	                {voiceProvider === "openai" ? (
  2762	                  <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
  2763	                    <p className="font-medium text-foreground">OpenAI presets</p>
  2764	                    <div className="flex flex-wrap gap-2">
  2765	                      <Button type="button" size="xs" variant={!voiceRealtime ? "secondary" : "outline"} onClick={() => onVoiceInputSettingsChange({ modelId: "whisper-1", realtime: false })}>
  2766	                        whisper-1
  2767	                      </Button>
  2768	                      <Button type="button" size="xs" variant={voiceRealtime ? "secondary" : "outline"} onClick={() => onVoiceInputSettingsChange({ modelId: "gpt-realtime-whisper", realtime: true })}>
  2769	                        GPT Realtime Whisper
  2770	                      </Button>
  2771	                    </div>
  2772	                  </div>
  2773	                ) : null}
  2774	                {voiceProvider === "custom" || voiceProvider === "local" ? (
  2775	                  <label className="grid gap-1 text-xs text-muted-foreground">
  2776	                    Transcription endpoint
  2777	                    <Input value={voiceEndpoint} onChange={(event) => onVoiceInputSettingsChange({ endpoint: event.target.value })} placeholder="http://127.0.0.1:9000/v1" />
  2778	                  </label>
  2779	                ) : null}
  2780	                {voiceProvider === "openai" || voiceProvider === "custom" ? (
  2781	                  <div className="grid gap-2 rounded-lg border border-border/60 p-3">
  2782	                    <label className="grid gap-1 text-xs text-muted-foreground">
  2783	                      API key
  2784	                      <Input
  2785	                        type="password"
  2786	                        value={voiceApiKey}
  2787	                        onChange={(event) => setVoiceApiKey(event.target.value)}
  2788	                        placeholder="Stored encrypted on the server"
  2789	                        autoComplete="new-password"
  2790	                      />
  2791	                    </label>
  2792	                    <div className="flex items-center justify-between gap-2">
  2793	                      <span className="text-[11px] text-muted-foreground">The key is never returned to the browser.</span>
  2794	                      <Button
  2795	                        type="button"
  2796	                        size="xs"
  2797	                        disabled={voiceKeyBusy || !voiceApiKey.trim()}
  2798	                        onClick={() => {
  2799	                          setVoiceKeyBusy(true);
  2800	                          void onVoiceApiKeySave(voiceApiKey).then(() => {
  2801	                            setVoiceApiKey("");
  2802	                            toast.success("Voice API key saved");
  2803	                          }).catch((error) => {
  2804	                            toast.error(error instanceof Error ? error.message : "Could not save voice API key.");
  2805	                          }).finally(() => setVoiceKeyBusy(false));
  2806	                        }}
  2807	                      >
  2808	                        {voiceKeyBusy ? "Saving…" : "Save key"}
  2809	                      </Button>
  2810	                    </div>
  2811	                  </div>
  2812	                ) : null}
  2813	                {voiceProvider === "custom" ? (
  2814	                  <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3 text-xs">
  2815	                    <span>
  2816	                      <span className="block font-medium text-foreground">Streaming transcription</span>
  2817	                      <span className="text-muted-foreground">Show partial speech above the composer.</span>
  2818	                    </span>
  2819	                    <Button type="button" size="sm" variant={voiceRealtime ? "default" : "outline"} aria-pressed={voiceRealtime} onClick={() => onVoiceInputSettingsChange({ realtime: !voiceRealtime })}>
  2820	                      {voiceRealtime ? "On" : "Off"}
  2821	                    </Button>
  2822	                  </label>
  2823	                ) : null}
  2824	                <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
  2825	                  <div>
  2826	                    <p className="text-xs font-medium">Microphone button</p>
  2827	                    <p className="text-xs text-muted-foreground">Enable voice input in the composer.</p>
  2828	                  </div>
  2829	                  <Button type="button" size="sm" variant={voiceInputEnabled ? "default" : "outline"} aria-pressed={voiceInputEnabled} onClick={() => onVoiceInputSettingsChange({ enabled: !voiceInputEnabled })}>
  2830	                    {voiceInputEnabled ? "On" : "Off"}
  2831	                  </Button>
  2832	                </div>
  2833	                <label className="grid max-w-xs gap-1 text-xs text-muted-foreground">
  2834	                  Maximum recording length (seconds)
  2835	                  <Input type="number" min={1} max={3600} value={voiceMaxDurationSeconds} disabled={!voiceInputEnabled} onChange={(event) => onVoiceInputSettingsChange({ maxDurationSeconds: Math.max(1, Math.min(3600, Number(event.target.value) || 300)) })} />
  2836	                </label>
  2837	              </section>
  2838	
  2839	              <section className="flex flex-col gap-4">
  2840	                <div>
  2841	                  <h3 id="settings-browser" className="text-sm font-medium">Browser</h3>
  2842	                  <p className="mt-1 text-xs text-muted-foreground">
  2843	                    Turn the embedded browser on or off, and set realtime preview, FPS, and the default viewport.
  2844	                  </p>
  2845	                </div>
  2846	                <BrowserSettingsControls
  2847	                  compact
  2848	                  browserEnabled={browserEnabled}
  2849	                  browserRealtime={browserRealtime}
  2850	                  browserFps={browserFps}
  2851	                  browserViewportWidth={browserViewportWidth}
  2852	                  browserViewportHeight={browserViewportHeight}
  2853	                  onChange={onBrowserSettingsChange}
  2854	                />
  2855	              </section>
  2856	
  2857	 <section className="flex flex-col gap-4">
  2858	 <div className="flex items-start justify-between gap-3">
  2859	 <div>
  2860	 <h3 id="settings-browser-storage" className="text-sm font-medium">Browser storage</h3>
  2861	 <p className="mt-1 text-xs text-muted-foreground">
  2862	 Persistent website sessions for the embedded browser. Search and clear origins in a dedicated view so General stays short.
  2863	 </p>
  2864	 </div>
  2865	 <Button type="button" variant="outline" size="sm" onClick={() => setSettingsPane("browser-storage")}>
  2866	 Manage
  2867	 </Button>
  2868	 </div>
  2869	 <p className="text-xs text-muted-foreground">
  2870	 {browserStorageLoading
  2871	 ? "Loading stored websites…"
  2872	 : browserStorage.length
  2873	 ? `${browserStorage.length} website${browserStorage.length === 1 ? "" : "s"} stored`
  2874	 : "No persistent website data stored yet."}
  2875	 </p>
  2876	 </section>
  2877	
  2878	              <section className="flex flex-col gap-3">
  2879	                <div>
  2880	                  <h3 id="settings-session" className="text-sm font-medium">Session</h3>
  2881	                  <p className="mt-1 text-xs text-muted-foreground">
  2882	                    Lock this chat and return to the sign-in screen.
  2883	                  </p>
  2884	                </div>
  2885	                <Button
  2886	                  variant="outline"
  2887	                  className="w-full justify-start gap-2"
  2888	                  onClick={() => {
  2889	                    onOpenChange(false);
  2890	                    onLogout();
  2891	                  }}
  2892	                >
  2893	                  <Lock className="size-4" />
  2894	                  Lock screen
  2895	                </Button>
  2896	
  2897	              </section>
  2898	
  2899	              <section className="flex flex-col gap-3">
  2900	                <div>
  2901	                  <h3 id="settings-links" className="text-sm font-medium">Links</h3>
  2902	                  <p className="mt-1 text-xs text-muted-foreground">
  2903	                    Visit the Metis website or view the source code on GitHub.
  2904	                  </p>
  2905	                </div>
  2906	                <div className="grid gap-2 sm:grid-cols-2">
  2907	                  <Button asChild variant="outline" className="h-11 w-full justify-between px-3">
  2908	                    <a href="https://metis.f1shy312.com" target="_blank" rel="noopener noreferrer">
  2909	                      <span className="flex items-center gap-2">
  2910	                        <Globe2 className="size-4" aria-hidden="true" />
  2911	                        Website
  2912	                      </span>
  2913	                      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
  2914	                    </a>
  2915	                  </Button>
  2916	                  <Button asChild variant="outline" className="h-11 w-full justify-between px-3">
  2917	                    <a href="https://github.com/f1shyondrugs/metis-ai" target="_blank" rel="noopener noreferrer">
  2918	                      <span className="flex items-center gap-2">
  2919	                        <GithubLogo className="size-4" aria-hidden="true" />
  2920	                        GitHub
  2921	                      </span>
  2922	                      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
  2923	                    </a>
  2924	                  </Button>
  2925	                </div>
  2926	              </section>
  2927	
  2928	 </TabsContent>
  2929	<TabsContent value="models" className="mt-0 space-y-8 px-6 py-6 sm:px-8 sm:py-8 min-w-0">
  2930	              <div id="settings-usage"><PlanUsagePanel snapshot={usageSnapshot} onRefresh={onRefreshUsage} /></div>
  2931	              <div className="grid gap-3 sm:grid-cols-2">
  2932	                <SettingsTile
  2933	                  id="settings-providers"
  2934	                  title="AI providers and connections"
  2935	                  meta={providersLoaded ? `${providerConnections.length} connection${providerConnections.length === 1 ? "" : "s"}` : "Loading…"}
  2936	                  icon={KeyRound}
  2937	                  onOpen={() => setSettingsPane("providers")}
  2938	                />
  2939	                <SettingsTile
  2940	                  id="settings-versions"
  2941	                  title="CLI versions"
  2942	                  meta="Installed agent CLI and SDK versions"
  2943	                  icon={Download}
  2944	                  onOpen={() => setSettingsPane("versions")}
  2945	                />
  2946	              </div>
  2947	 </TabsContent>
  2948	<TabsContent value="agent" className="mt-0 px-6 py-6 sm:px-8 sm:py-8">
  2949	              <div className="grid gap-3 sm:grid-cols-2">
  2950	                <SettingsTile
  2951	                  id="settings-skills"
  2952	                  title="Skills"
  2953	                  meta="Enable, pin, and add skills"
  2954	                  icon={Puzzle}
  2955	                  onOpen={() => setSettingsPane("skills")}
  2956	                />
  2957	                <SettingsTile
  2958	                  id="settings-modes"
  2959	                  title="Agent modes"
  2960	                  meta={customModes.length ? `${customModes.length} custom mode${customModes.length === 1 ? "" : "s"}` : "Built-in plus custom modes"}
  2961	                  icon={Settings2}
  2962	                  onOpen={() => setSettingsPane("modes")}
  2963	                />
  2964	                <SettingsTile
  2965	                  id="settings-mcp"
  2966	                  title="Custom MCP servers"
  2967	                  meta={mcpLoaded ? `${mcpServers.length} server${mcpServers.length === 1 ? "" : "s"}` : "Loading…"}
  2968	                  icon={Server}
  2969	                  onOpen={() => setSettingsPane("mcp")}
  2970	                />
  2971	                <SettingsTile
  2972	                  id="settings-memories"
  2973	                  title="Agent Rules"
  2974	                  meta={memories.length ? `${memories.length} ${memories.length === 1 ? "rule" : "rules"}` : "No agent rules yet"}
  2975	                  icon={Brain}
  2976	                  onOpen={() => setSettingsPane("memories")}
  2977	                />
  2978	                <SettingsTile
  2979	                  id="settings-response-instructions"
  2980	                  title="Response instructions"
  2981	                  meta="Set how the agent replies"
  2982	                  icon={MessagesSquare}
  2983	                  onOpen={() => setSettingsPane("response-instructions")}
  2984	                />
  2985	              </div>
  2986	 </TabsContent>
  2987	<TabsContent value="devices" className="mt-0 space-y-10 px-6 py-6 sm:px-8 sm:py-8">
  2988	
  2989	              <section className="flex flex-col gap-5">
  2990	                <div className="flex flex-wrap items-start justify-between gap-3">
  2991	                  <div>
  2992	                    <h3 id="settings-remote-clients" className="text-sm font-medium">Remote Clients</h3>
  2993	                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
  2994	                      Clients use an outbound encrypted connection. New clients start in user access; administrative capabilities are never implicit.
  2995	                    </p>
  2996	                  </div>
  2997	                  <Button type="button" size="sm" onClick={() => setRemotePairStep("os")} disabled={remoteBusy}>
  2998	                    <Plus data-icon="inline-start" />
  2999	                    Add client
  3000	                  </Button>
  3001	                </div>
  3002	                <div className="rounded-lg border bg-card/40 p-3">
  3003	                  <div className="flex flex-wrap items-start justify-between gap-2">
  3004	                    <div>
  3005	                      <h4 className="text-xs font-medium">Global command allowlist</h4>
  3006	                      <p className="mt-1 text-xs text-muted-foreground">These exact commands are available to every device that has Run commands enabled.</p>
  3007	                    </div>
  3008	                    <Button type="button" size="sm" disabled={remoteGlobalAllowlistBusy || !remoteGlobalAllowlistLoaded} onClick={() => void saveGlobalRemoteAllowlist()}>
  3009	                      {remoteGlobalAllowlistBusy ? "Saving…" : "Save global list"}
  3010	                    </Button>
  3011	                  </div>
  3012	                  <Textarea
  3013	                    value={remoteGlobalAllowlistDraft}
  3014	                    disabled={!remoteGlobalAllowlistLoaded}
  3015	                    onChange={(event) => setRemoteGlobalAllowlistDraft(event.target.value)}
  3016	                    placeholder={"One exact command per line\ne.g. whoami"}
  3017	                    rows={3}
  3018	                    aria-label="Global command allowlist"
  3019	                    className="mt-3 font-mono text-xs"
  3020	                  />
  3021	                  {!remoteGlobalAllowlistLoaded && !remoteGlobalAllowlistError ? <p className="mt-2 text-xs text-muted-foreground">Loading global allowlist…</p> : null}
  3022	                  {remoteGlobalAllowlistError ? (
  3023	                    <div className="mt-2 flex items-center gap-2">
  3024	                      <p role="alert" className="text-xs text-destructive">{remoteGlobalAllowlistError}</p>
  3025	                      <Button type="button" size="sm" variant="outline" onClick={() => void loadGlobalRemoteAllowlist()}>Retry</Button>
  3026	                    </div>
  3027	                  ) : null}
  3028	                </div>
  3029	                <div className="flex flex-col gap-2">
  3030	                  {remoteClients.length ? remoteClients.map((client) => (
  3031	                    <div key={client.id} className="rounded-lg border bg-card/40 p-3">
  3032	                      <div className="flex flex-wrap items-center justify-between gap-3">
  3033	                        <div className="flex min-w-0 items-start gap-2">
  3034	                          {String(client.os ?? "").toLowerCase().includes("win") ? <MicrosoftLogo className="mt-1 size-4 shrink-0 text-muted-foreground" /> : String(client.os ?? "").toLowerCase().includes("mac") ? <AppleLogo className="mt-1 size-4 shrink-0 text-muted-foreground" /> : <Server className="mt-1 size-4 shrink-0 text-muted-foreground" />}
  3035	                          <div className="min-w-0">
  3036	                          <Input
  3037	                           key={`${client.id}:${client.name}`}
  3038	                            defaultValue={client.name}
  3039	                            aria-label={`Custom name for ${client.name}`}
  3040	                            className="h-7 max-w-[16rem] border-transparent px-0 text-sm font-medium shadow-none focus-visible:border-input focus-visible:px-2"
  3041	                            onBlur={(event) => void renameRemoteClient(client, event.target.value)}
  3042	                          />
  3043	                          <p className="text-xs text-muted-foreground">
  3044	                            {client.hostname || "Unknown host"} · {client.os || "Unknown OS"} · {client.architecture || "unknown arch"}
  3045	                          </p>
  3046	                          <div className="mt-1.5 flex flex-wrap gap-1.5">
  3047	                            <Badge variant={client.permissionMode === "admin" ? "default" : "outline"}>
  3048	                              {client.permissionMode === "admin" ? "Admin / system access" : "User access · no administrator rights"}
  3049	                            </Badge>
  3050	                            <Badge variant="outline">{client.policy.mode === "full_access" ? "Full Access" : `${client.policy.permissions.length} permissions enabled`}</Badge>
  3051	                            {client.capabilities?.includes("desktop_gui") ? <Badge variant="outline">Computer Use {client.policy.permissions.includes("computer_use") ? "on" : "off"}</Badge> : null}
  3052	                            {desktopStatusById[client.id] ? <Badge variant={desktopStatusById[client.id].available ? "outline" : "secondary"}>{desktopStatusById[client.id].available ? "Desktop ready" : "Needs OS permissions"}</Badge> : null}
  3053	                          </div>
  3054	                          </div>
  3055	                        </div>
  3056	                        <div className="flex items-center gap-1">
  3057	                          <span className={`size-2 rounded-full ${client.status === "online" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} title={client.status} />
  3058	                          <RemotePermissionsEditor client={client} onSave={updateRemotePolicy} desktopStatus={desktopStatusById[client.id]} desktopBusy={desktopStatusBusyId === client.id} onCheckDesktop={(prompt) => checkDesktopPermissions(client, prompt)} />
  3059	                          <DropdownMenu>
  3060	                            <DropdownMenuTrigger asChild><Button type="button" size="icon-xs" variant="ghost" className="max-md:min-h-11 max-md:min-w-11" aria-label={`Manage ${client.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
  3061	                            <DropdownMenuContent align="end">
  3062	                              <DropdownMenuItem onClick={() => void testRemoteConnection(client)}>Test connection</DropdownMenuItem>
  3063	                              {client.capabilities?.includes("desktop_gui") ? <DropdownMenuItem onClick={() => void checkDesktopPermissions(client)}>Check desktop permissions</DropdownMenuItem> : null}
  3064	                              <DropdownMenuItem className="text-destructive" onClick={() => setRemoteClientDeleteTarget(client)}>Remove client</DropdownMenuItem>
  3065	                            </DropdownMenuContent>
  3066	                          </DropdownMenu>
  3067	                        </div>
  3068	                      </div>
  3069	                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
  3070	                        <span>{client.status}</span>
  3071	                        {client.version ? <span>v{client.version}</span> : null}
  3072	                        {client.lastSeenAt ? <span>seen {new Date(client.lastSeenAt).toLocaleString()}</span> : null}
  3073	                      </div>
  3074	                    </div>
  3075	                  )) : (
  3076	                    <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No remote clients enrolled yet.</p>
  3077	                  )}
  3078	                </div>
  3079	              </section>
  3080	 </TabsContent>
  3081	<TabsContent value="admin" className="mt-0 space-y-10 px-6 py-6 sm:px-8 sm:py-8">
  3082	{isHostAdmin ? (
  3083	                <div id="settings-users"><AdminUsersPanel /></div>) : null}
  3084	
  3085	              <section className="flex flex-col gap-4">
  3086	                <div>
  3087	                  <h3 id="settings-archived" className="flex items-center gap-2 text-sm font-medium">
  3088	                    <Archive className="size-4 text-muted-foreground" />
  3089	                    Archived chats
  3090	                  </h3>
  3091	                  <p className="mt-1 text-xs text-muted-foreground">
  3092	                    Archived chats disappear from the sidebar but remain available in chat search.
  3093	                  </p>
  3094	                </div>
  3095	                {!archivedChatsLoaded ? (
  3096	                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
  3097	                    Loading archived chats…
  3098	                  </div>
  3099	                ) : archivedChats.length === 0 ? (
  3100	                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
  3101	                    No archived chats.
  3102	                  </div>
  3103	                ) : (
  3104	                  <ul className="flex flex-col gap-2">
  3105	                    {archivedChats.map((chat) => (
  3106	                      <li
  3107	                        key={chat.id}
  3108	                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
  3109	                      >
  3110	                        <div className="min-w-0 flex-1">
  3111	                          <p className="truncate text-sm font-medium">{chat.title || "Untitled"}</p>
  3112	                          <p className="mt-0.5 text-xs text-muted-foreground">
  3113	                            Archived chat
  3114	                          </p>
  3115	                        </div>
  3116	                        <Button
  3117	                          type="button"
  3118	                          size="sm"
  3119	                          variant="outline"
  3120	                          onClick={() => void updateArchivedChat(chat.id, false)}
  3121	                        >
  3122	                          <ArchiveRestore className="size-3.5" />
  3123	                          Restore
  3124	                        </Button>
  3125	                        <Button
  3126	                          type="button"
  3127	                          size="icon-sm"
  3128	                          variant="ghost"
  3129	                          aria-label={`Delete ${chat.title || "archived chat"}`}
  3130	                          onClick={() => void deleteArchivedChat(chat.id)}
  3131	                        >
  3132	                          <Trash2 className="size-3.5" />
  3133	                        </Button>
  3134	                      </li>
  3135	                    ))}
  3136	                  </ul>
  3137	                )}
  3138	                <div className="border-t border-border/60 pt-5">
  3139	                  <div>
  3140	                    <h3 id="settings-shared" className="flex items-center gap-2 text-sm font-medium">
  3141	                      <Link2 className="size-4 text-muted-foreground" />
  3142	                      Shared chats
  3143	                    </h3>
  3144	                    <p className="mt-1 text-xs text-muted-foreground">
  3145	                      Manage active read-only links for your chats.
  3146	                    </p>
  3147	                  </div>
  3148	                  {sharedChats.length === 0 ? (
  3149	                    <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
  3150	                      No active shared chats.
  3151	                    </div>
  3152	                  ) : (
  3153	                    <ul className="mt-3 flex flex-col gap-2">
  3154	                      {sharedChats.map((chat) => (
  3155	                        <li key={chat.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
  3156	                          <div className="min-w-0 flex-1">
  3157	                            <p className="truncate text-sm font-medium">{chat.title || "Untitled"}</p>
  3158	                            <p className="mt-0.5 text-xs text-muted-foreground">
  3159	                              {chat.share?.passwordProtected ? "Password protected" : "Public link"}
  3160	                            </p>
  3161	                          </div>
  3162	                          {chat.share ? (
  3163	                            <a
  3164	                              href={`/share?id=${encodeURIComponent(chat.share.id)}`}
  3165	                              target="_blank"
  3166	                              rel="noreferrer"
  3167	                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent"
  3168	                            >
  3169	                              <Link2 className="size-3.5" />
  3170	                              Open link
  3171	                            </a>
  3172	                          ) : null}
  3173	                          <Button type="button" size="sm" variant="outline" onClick={() => void deactivateShare(chat)}>
  3174	                            Deactivate
  3175	                          </Button>
  3176	                        </li>
  3177	                      ))}
  3178	                    </ul>
  3179	                  )}
  3180	                </div>
  3181	              </section>
  3182	
  3183	{isHostAdmin ? (
  3184	                  <div className="mt-3 border-t border-destructive/30 pt-4">
  3185	                    <h3 id="settings-maintenance" className="text-sm font-medium">Metis maintenance</h3>
  3186	                    <p className="mt-1 text-xs text-muted-foreground">
  3187	                      Prepare a production update or reset Metis to its clean initial state.
  3188	                    </p>
  3189	                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
  3190	                      <Button type="button" variant="outline" onClick={() => setUpdateMetisOpen(true)}>
  3191	                        <RefreshCw data-icon="inline-start" />
  3192	                        Update Metis
  3193	                      </Button>
  3194	                      <Button type="button" variant="destructive" onClick={() => setResetMetisOpen(true)}>
  3195	                        <RotateCcw data-icon="inline-start" />
  3196	                        Reset account
  3197	                      </Button>
  3198	                    </div>
  3199	                  </div>
  3200	                ) : null}
  3201	 </TabsContent>
  3202	 </>
  3203	 )}
  3204	          </div>
  3205	        </Tabs>
  3206	      </DialogContent>
  3207	      </Dialog>
  3208	      <Dialog open={remotePairStep !== "idle"} onOpenChange={(value) => !value && setRemotePairStep("idle")}>
  3209	        <DialogContent className="box-border w-[calc(100vw_-_2rem)] max-w-[calc(100vw_-_2rem)] gap-0 overflow-x-hidden overflow-y-auto rounded-2xl p-0 sm:w-[min(56rem,calc(100vw_-_2rem))] sm:max-w-[min(56rem,calc(100vw_-_2rem))]">
  3210	          <div className="min-w-0 w-full max-w-full space-y-5 p-6">
  3211	          <DialogHeader>
  3212	            <DialogTitle>Connect a remote client</DialogTitle>
  3213	            <DialogDescription>
  3214	              Pair a device with this account and keep it available for terminal sessions.
  3215	            </DialogDescription>
  3216	          </DialogHeader>
  3217	          <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" aria-label="Remote client setup progress">
  3218	            {["Choose OS", "Install", "Connected"].map((label, index) => {
  3219	              const activeIndex = remotePairStep === "os" ? 0 : remotePairStep === "install" ? 1 : 2;
  3220	              const complete = index < activeIndex;
  3221	              return (
  3222	                <div key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
  3223	                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium", index <= activeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
  3224	                    {complete ? <Check className="size-3" /> : index + 1}
  3225	                  </span>
  3226	                  <span className={cn("truncate", index <= activeIndex && "text-foreground")}>{label}</span>
  3227	                  {index < 2 ? <span className="mx-1 h-px flex-1 bg-border" /> : null}
  3228	                </div>
  3229	              );
  3230	            })}
  3231	          </div>
  3232	          {remotePairStep === "os" ? (
  3233	            <div className="space-y-4 pt-1">
  3234	              <div className="space-y-2" role="radiogroup" aria-label="Permission mode">
  3235	                <p className="text-sm font-medium">Permission mode</p>
  3236	                <div className="grid gap-2 sm:grid-cols-2">
  3237	                  {([["user", "User access", "User files, processes, and allowed directories only. No UAC prompt."], ["admin", "Admin / system access", "For all users. UAC required; system actions stay capability-gated and confirmation-gated."]] as const).map(([value, label, description]) => (
  3238	                    <button key={value} type="button" role="radio" aria-checked={remotePermissionMode === value} onClick={() => setRemotePermissionMode(value)} className={cn("rounded-xl border p-3 text-left transition-colors", remotePermissionMode === value ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/50")}>
  3239	                      <span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span>
  3240	                    </button>
  3241	                  ))}
  3242	                </div>
  3243	              </div>
  3244	              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
  3245	              {([
  3246	                ["linux", "Linux", Server],
  3247	                ["windows", "Windows", MicrosoftLogo],
  3248	                ["macos", "macOS", AppleLogo],
  3249	              ] as const).map(([value, label, Icon]) => (
  3250	                <Button key={value} type="button" variant="outline" className="h-24 flex-col gap-2 rounded-xl" onClick={() => void createRemoteEnrollment(value)} disabled={remoteBusy}>
  3251	                  <Icon className="size-8" />
  3252	                  <span>{label}</span>
  3253	                </Button>
  3254	              ))}
  3255	              </div>
  3256	            </div>
  3257	          ) : remotePairStep === "install" ? (
  3258	            <div className="min-w-0 space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
  3259	              {remoteInstallerUrls.length > 0 ? (
  3260	                <>
  3261	                  <div>
  3262	                    <p className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4 text-primary" /> Install the {remotePlatform === "macos" ? "macOS" : remotePlatform === "linux" ? "Linux" : "Windows"} app</p>
  3263	                    <p className="mt-1 text-xs text-muted-foreground">Install the app, open it, then enter this server URL and pairing code. The code expires after 15 minutes. {remotePlatform === "windows" && remotePermissionMode === "admin" ? "For admin access, start the app as administrator and confirm UAC." : remotePlatform === "macos" ? "Drag the app into Applications. Desktop control needs Screen Recording and Accessibility permissions." : remotePlatform === "linux" ? "Make the AppImage executable and open it. Desktop control needs an X11 session, xdotool, wmctrl and ImageMagick." : "User access runs without administrator rights."}</p>
  3264	                  </div>
  3265	                  <div className="flex flex-wrap gap-2">
  3266	                    {remoteInstallerUrls.map((installer) => <a key={installer.url} href={installer.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2">Download {installer.label}</a>)}
  3267	                  </div>
  3268	                  {remotePlatform === "macos" ? (
  3269	                    <div className="space-y-2 rounded-lg border border-border/70 bg-background p-3">
  3270	                      <p className="text-sm font-medium">Is it saying “damaged”?</p>
  3271	                      <p className="text-xs text-muted-foreground">macOS marks unsigned browser downloads as damaged. The file is fine. Run this in Terminal, then open the app:</p>
  3272	                      <div className="flex gap-2">
  3273	                        <Input readOnly value={'xattr -cr "/Applications/Metis AI Remote Client.app"'} aria-label="Fix damaged macOS app command" className="font-mono text-xs" />
  3274	                        <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText('xattr -cr "/Applications/Metis AI Remote Client.app"')}>Copy</Button>
  3275	                      </div>
  3276	                    </div>
  3277	                  ) : null}
  3278	                  <div className="space-y-2">
  3279	                    <p className="text-xs font-medium">Server URL</p>
  3280	                    <div className="flex gap-2"><Input readOnly value={remoteServerUrl} aria-label="Server URL" /><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(remoteServerUrl)}>Copy</Button></div>
  3281	                  </div>
  3282	                  <div className="space-y-2">
  3283	                    <p className="text-xs font-medium">Pairing code</p>
  3284	                    <div className="flex gap-2"><Input readOnly value={remotePairToken} aria-label="Pairing code" className="font-mono" /><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(remotePairToken)}>Copy</Button></div>
  3285	                  </div>
  3286	                </>
  3287	              ) : (
  3288	                <>
  3289	                  <div>
  3290	                    <p className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4 text-primary" /> Install the client</p>
  3291	                    <p className="mt-1 text-xs text-muted-foreground">Run this command on the device you want to connect. The installer includes Node.js and verifies the connection.</p>
  3292	                  </div>
  3293	                  <div className="w-full min-w-0 max-w-full overflow-hidden">
  3294	                    <Textarea readOnly value={remoteCommands?.[remotePlatform] || remoteCommand} className="block min-h-32 w-full min-w-0 max-w-full resize-y overflow-auto [field-sizing:fixed] bg-background font-mono text-xs" />
  3295	                  </div>
  3296	                  <div className="flex flex-wrap justify-end gap-2">
  3297	                    <Button type="button" variant="outline" onClick={() => void copyRemoteCommand()}>Copy install command</Button>
  3298	                  </div>
  3299	                </>
  3300	              )}
  3301	              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
  3302	                <RefreshCw className="size-3.5 animate-spin" />
  3303	                Waiting for the device to connect…
  3304	              </div>
  3305	            </div>
  3306	          ) : (
  3307	            <div className="flex flex-col items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6 text-center">
  3308	              <div className="relative flex size-16 items-center justify-center">
  3309	                <span className="absolute inset-0 rounded-full border border-emerald-500/20 animate-in fade-in zoom-in-75 duration-500" />
  3310	                <span className="relative flex size-12 items-center justify-center rounded-full border-2 border-emerald-500 text-emerald-500 animate-in zoom-in-50 duration-500">
  3311	                  <Check className="size-6 animate-in zoom-in-50 delay-150 duration-500" strokeWidth={3} />
  3312	                </span>
  3313	              </div>
  3314	              <div><p className="text-sm font-medium">Connected</p><p className="mt-1 text-xs text-muted-foreground">The remote client is ready to use. You can close this window.</p></div>
  3315	              <Button type="button" onClick={() => setRemotePairStep("idle")}>Done</Button>
  3316	            </div>
  3317	          )}
  3318	          </div>
  3319	        </DialogContent>
  3320	      </Dialog>
  3321	      <ConfirmDialog
  3322	        open={Boolean(remoteClientDeleteTarget)}
  3323	        onOpenChange={(open) => !open && setRemoteClientDeleteTarget(null)}
  3324	        title="Remove remote client?"
  3325	        description={remoteClientDeleteTarget ? `Remove “${remoteClientDeleteTarget.name}” from this dashboard? The local client must still be uninstalled separately.` : ""}
  3326	        confirmLabel="Remove client"
  3327	        onConfirm={() => remoteClientDeleteTarget ? revokeRemoteClient(remoteClientDeleteTarget) : undefined}
  3328	      />
  3329	      <ConfirmDialog
  3330	      open={Boolean(deleteTarget)}
  3331	      onOpenChange={(open) => !open && setDeleteTarget(null)}
  3332	      title={deleteTarget?.type === "mcp" ? "Delete MCP server?" : "Delete provider connection?"}
  3333	      description={
  3334	        deleteTarget?.type === "mcp"
  3335	          ? `Are you sure you want to delete “${deleteTarget.item.name}”? This action cannot be undone.`
  3336	          : `Are you sure you want to delete “${deleteTarget?.item.label || "this connection"}”? This action cannot be undone.`
  3337	      }
  3338	      confirmLabel="Delete"
  3339	      onConfirm={() => {
  3340	        if (!deleteTarget) return;
  3341	        return deleteTarget.type === "mcp"
  3342	          ? deleteMcpServer(deleteTarget.item)
  3343	          : deleteProviderConnection(deleteTarget.item);
  3344	      }}
  3345	      />
  3346	      <ConfirmDialog
  3347	        open={Boolean(browserStorageDeleteTarget)}
  3348	        onOpenChange={(open) => !open && setBrowserStorageDeleteTarget(null)}
  3349	        title="Clear website data?"
  3350	        description={browserStorageDeleteTarget ? `All persistent browser data for “${browserStorageDeleteTarget}” will be removed.` : ""}
  3351	        confirmLabel="Clear data"
  3352	        onConfirm={async () => {
  3353	          if (!browserStorageDeleteTarget) return;
  3354	          await clearBrowserStorage(browserStorageDeleteTarget);
  3355	          setBrowserStorageDeleteTarget(null);
  3356	        }}
  3357	      />
  3358	      <ConfirmDialog
  3359	        open={browserStorageClearAll}
  3360	        onOpenChange={setBrowserStorageClearAll}
  3361	        title="Clear all browser data?"
  3362	        description="This logs you out of every website in the embedded browser and cannot be undone."
  3363	        confirmLabel="Clear everything"
  3364	        onConfirm={async () => {
  3365	          await clearBrowserStorage();
  3366	          setBrowserStorageClearAll(false);
  3367	        }}
  3368	      />
  3369	      <ConfirmDialog
  3370	        open={updateMetisOpen}
  3371	        onOpenChange={setUpdateMetisOpen}
  3372	        title="Update Metis?"
  3373	        description="Metis will install the locked dependencies and build the inactive production slot. The active service will not be restarted automatically."
  3374	        confirmLabel="Prepare update"
  3375	        destructive={false}
  3376	        onConfirm={async () => {
  3377	          if (onUpdateMetis) await onUpdateMetis();
  3378	        }}
  3379	      />
  3380	      <ConfirmDialog
  3381	        open={resetMetisOpen}
  3382	        onOpenChange={setResetMetisOpen}
  3383	        title="Reset all Metis data?"
  3384	        description="This permanently removes chats, notes, memories, provider credentials, MCP servers, workflows, browser data, automations, remote clients, jobs and usage history. User accounts and the base installation remain. You will be signed out and must set up Metis again."
  3385	        confirmLabel="Reset everything"
  3386	        onConfirm={async () => {
  3387	          if (onResetMetis) await onResetMetis();
  3388	        }}
  3389	      />
  3390	    </>
  3391	  );
  3392	}
