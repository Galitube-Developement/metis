     1	import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
     2	import {
     3	  getGlobalModelSettings,
     4	  saveGlobalModelSettings,
     5	  type GlobalModelSettings,
     6	} from "@/lib/db-store";
     7	import { normalizeVoiceSettings } from "@/lib/shared-context";
     8	import type { CompressionMode } from "@/lib/compression";
     9	
    10	export const runtime = "nodejs";
    11	export const dynamic = "force-dynamic";
    12	
    13	export async function GET(req: Request) {
    14	  if (!(await isAuthenticated(req))) {
    15	    return Response.json({ error: "Unauthorized" }, { status: 401 });
    16	  }
    17	  return Response.json({ settings: getGlobalModelSettings((await getAuthenticatedUserId(req)) ?? undefined) });
    18	}
    19	
    20	export async function PATCH(req: Request) {
    21	  if (!(await isAuthenticated(req))) {
    22	    return Response.json({ error: "Unauthorized" }, { status: 401 });
    23	  }
    24	  const body = (await req.json().catch(() => ({}))) as {
    25	    modelId?: unknown;
    26	    modelParams?: unknown;
    27	    modelParamsByModel?: unknown;
    28	    lastModelByProvider?: unknown;
    29	    subagentModelEnabled?: unknown;
    30	    subagentModelId?: unknown;
    31	    draftInput?: unknown;
    32	    pinnedNoteIds?: unknown;
    33	    favoriteModelKeys?: unknown;
    34	    modelAliases?: unknown;
    35	    browserRealtime?: unknown;
    36	    browserFps?: unknown;
    37	    browserViewportWidth?: unknown;
    38	    browserViewportHeight?: unknown;
    39	    voiceInput?: unknown;
    40	    featureFlags?: unknown;
    41	    compression?: unknown;
    42	    responseInstructions?: unknown;
    43	  };
    44	  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
    45	  const current = getGlobalModelSettings(userId);
    46	  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : undefined;
    47	  const modelParams = Array.isArray(body.modelParams)
    48	    ? body.modelParams.filter(
    49	        (item): item is { id: string; value: string } =>
    50	          Boolean(item) &&
    51	          typeof item === "object" &&
    52	          typeof (item as { id?: unknown }).id === "string" &&
    53	          (item as { id: string }).id !== "uncensored" &&
    54	          typeof (item as { value?: unknown }).value === "string",
    55	      )
    56	    : undefined;
    57	  const modelParamsByModel =
    58	    body.modelParamsByModel &&
    59	    typeof body.modelParamsByModel === "object" &&
    60	    !Array.isArray(body.modelParamsByModel)
    61	      ? Object.fromEntries(
    62	          Object.entries(body.modelParamsByModel)
    63	            .slice(0, 200)
    64	            .map(([key, value]) => [
    65	              key.trim().slice(0, 500),
    66	              Array.isArray(value)
    67	                ? value
    68	                    .filter(
    69	                      (item): item is { id: string; value: string } =>
    70	                        Boolean(item) &&
    71	                        typeof item === "object" &&
    72	                        typeof (item as { id?: unknown }).id === "string" &&
    73	                        (item as { id: string }).id !== "uncensored" &&
    74	                        typeof (item as { value?: unknown }).value === "string",
    75	                    )
    76	                    .slice(0, 50)
    77	                : [],
    78	            ])
    79	            .filter(([key]) => Boolean(key)),
    80	        )
    81	      : undefined;
    82	  const lastModelByProvider =
    83	    body.lastModelByProvider &&
    84	    typeof body.lastModelByProvider === "object" &&
    85	    !Array.isArray(body.lastModelByProvider)
    86	      ? Object.fromEntries(
    87	          Object.entries(body.lastModelByProvider)
    88	            .filter((entry): entry is [string, string] =>
    89	              typeof entry[0] === "string" &&
    90	              typeof entry[1] === "string" &&
    91	              Boolean(entry[0].trim()) &&
    92	              Boolean(entry[1].trim()),
    93	            )
    94	            .slice(0, 100)
    95	            .map(([providerId, modelId]) => [
    96	              providerId.trim().slice(0, 120),
    97	              modelId.trim().slice(0, 500),
    98	            ]),
    99	        )
   100	      : undefined;
   101	  const subagentModelId =
   102	    typeof body.subagentModelId === "string" ? body.subagentModelId.trim() : undefined;
   103	  const subagentModelEnabled =
   104	    typeof body.subagentModelEnabled === "boolean" ? body.subagentModelEnabled : undefined;
   105	  const draftInput =
   106	    typeof body.draftInput === "string" ? body.draftInput.slice(0, 100_000) : undefined;
   107	  const pinnedNoteIds = Array.isArray(body.pinnedNoteIds)
   108	    ? body.pinnedNoteIds
   109	        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
   110	        .map((item) => item.trim().slice(0, 120))
   111	        .slice(0, 20)
   112	    : undefined;
   113	  const favoriteModelKeys = Array.isArray(body.favoriteModelKeys)
   114	    ? body.favoriteModelKeys
   115	        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
   116	        .map((item) => item.trim().slice(0, 300))
   117	        .slice(0, 100)
   118	    : undefined;
   119	  const modelAliases = body.modelAliases && typeof body.modelAliases === "object" && !Array.isArray(body.modelAliases)
   120	    ? Object.fromEntries(
   121	        Object.entries(body.modelAliases)
   122	          .filter((entry): entry is [string, string] =>
   123	            typeof entry[0] === "string" &&
   124	            typeof entry[1] === "string" &&
   125	            entry[0].trim().length > 0 &&
   126	            entry[1].trim().length > 0,
   127	          )
   128	          .slice(0, 100)
   129	          .map(([key, value]) => [key.trim().slice(0, 300), value.trim().slice(0, 120)]),
   130	      )
   131	    : undefined;
   132	  const browserRealtime =
   133	    typeof body.browserRealtime === "boolean" ? body.browserRealtime : undefined;
   134	  const browserFps =
   135	    typeof body.browserFps === "number" && Number.isFinite(body.browserFps)
   136	      ? Math.max(1, Math.min(30, Math.round(body.browserFps)))
   137	      : undefined;
   138	  const browserViewportWidth =
   139	    typeof body.browserViewportWidth === "number" && Number.isFinite(body.browserViewportWidth)
   140	      ? Math.max(320, Math.min(2560, Math.round(body.browserViewportWidth)))
   141	      : undefined;
   142	  const browserViewportHeight =
   143	    typeof body.browserViewportHeight === "number" && Number.isFinite(body.browserViewportHeight)
   144	      ? Math.max(240, Math.min(1600, Math.round(body.browserViewportHeight)))
   145	      : undefined;
   146	  const voiceInput =
   147	    body.voiceInput && typeof body.voiceInput === "object" && !Array.isArray(body.voiceInput)
   148	      ? normalizeVoiceSettings(body.voiceInput as GlobalModelSettings["voiceInput"])
   149	      : undefined;
   150	  const featureFlags =
   151	    body.featureFlags && typeof body.featureFlags === "object" && !Array.isArray(body.featureFlags)
   152	      ? Object.fromEntries(
   153	          Object.entries(body.featureFlags)
   154	            .filter(([key, value]) => ["plans", "notes", "recovery", "askUserTimeout", "voiceInput", "browser"].includes(key) && typeof value === "boolean"),
   155	        )
   156	      : undefined;
   157	  const responseInstructions =
   158	    typeof body.responseInstructions === "string"
   159	      ? body.responseInstructions.slice(0, 20_000)
   160	      : undefined;
   161	  const compression =
   162	    body.compression && typeof body.compression === "object" && !Array.isArray(body.compression)
   163	      ? (() => {
   164	          const value = body.compression as Record<string, unknown>;
   165	          const modes = new Set(["lite", "standard", "aggressive", "ultra", "rtk", "stacked"]);
   166	          const mode = typeof value.mode === "string" && modes.has(value.mode)
   167	            ? value.mode as CompressionMode
   168	            : undefined;
   169	          return {
   170	            ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
   171	            ...(mode ? { mode } : {}),
   172	            ...(typeof value.compressToolResults === "boolean" ? { compressToolResults: value.compressToolResults } : {}),
   173	            ...(typeof value.compressChatHistory === "boolean" ? { compressChatHistory: value.compressChatHistory } : {}),
   174	          };
   175	        })()
   176	      : undefined;
   177	  return Response.json({
   178	    settings: saveGlobalModelSettings(
   179	      {
   180	        ...current,
   181	        ...(modelId !== undefined ? { modelId } : {}),
   182	        ...(modelParams !== undefined ? { modelParams } : {}),
   183	        ...(modelParamsByModel !== undefined ? { modelParamsByModel } : {}),
   184	        ...(lastModelByProvider !== undefined ? { lastModelByProvider } : {}),
   185	        ...(subagentModelId !== undefined ? { subagentModelId } : {}),
   186	        ...(subagentModelEnabled !== undefined ? { subagentModelEnabled } : {}),
   187	        ...(draftInput !== undefined ? { draftInput } : {}),
   188	        ...(pinnedNoteIds !== undefined ? { pinnedNoteIds } : {}),
   189	        ...(favoriteModelKeys !== undefined ? { favoriteModelKeys } : {}),
   190	        ...(modelAliases !== undefined ? { modelAliases } : {}),
   191	        ...(browserRealtime !== undefined ? { browserRealtime } : {}),
   192	        ...(browserFps !== undefined ? { browserFps } : {}),
   193	        ...(browserViewportWidth !== undefined ? { browserViewportWidth } : {}),
   194	        ...(browserViewportHeight !== undefined ? { browserViewportHeight } : {}),
   195	        ...(voiceInput !== undefined ? { voiceInput } : {}),
   196	        ...(featureFlags !== undefined ? { featureFlags: { ...current.featureFlags, ...featureFlags } } : {}),
   197	        ...(compression !== undefined ? { compression: { ...current.compression, ...compression } } : {}),
   198	        ...(responseInstructions !== undefined ? { responseInstructions } : {}),
   199	      },
   200	      userId,
   201	    ),
   202	  });
   203	}
