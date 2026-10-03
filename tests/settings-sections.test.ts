     1	import assert from "node:assert/strict";
     2	import { readFileSync } from "node:fs";
     3	import test from "node:test";
     4	
     5	const settingsSource = readFileSync(new URL("../components/settings-panel.tsx", import.meta.url), "utf8");
     6	
     7	function parseSettingsSections(source: string) {
     8	  const block = source.match(/const SETTINGS_SECTIONS[^=]*= \{([\s\S]*?)\n\};/);
     9	  assert.ok(block, "SETTINGS_SECTIONS is defined");
    10	  const sections: Record<string, string[]> = {};
    11	  for (const match of block[1].matchAll(/(\w+): \[([\s\S]*?)\],/g)) {
    12	    sections[match[1]] = [...match[2].matchAll(/id: "(settings-[^"]+)"/g)].map((item) => item[1]);
    13	  }
    14	  return sections;
    15	}
    16	
    17	function headingIdsInTab(source: string, tab: string) {
    18	  const tabStart = source.indexOf(`<TabsContent value="${tab}"`);
    19	  assert.ok(tabStart >= 0, `${tab} tab exists`);
    20	  const tabEnd = source.indexOf("</TabsContent>", tabStart);
    21	  return [...source.slice(tabStart, tabEnd).matchAll(/id="(settings-[^"]+)"/g)].map((item) => item[1]);
    22	}
    23	
    24	test("settings subsection links match the heading order in each tab", () => {
    25	  const sections = parseSettingsSections(settingsSource);
    26	  assert.deepEqual(sections.general, [
    27	    "settings-subagent-model",
    28	    "settings-token-compression",
    29	    "settings-notifications",
    30	    "settings-voice-input",
    31	    "settings-browser",
    32	    "settings-browser-storage",
    33	    "settings-session",
    34	    "settings-links",
    35	  ]);
    36	  for (const tab of Object.keys(sections)) {
    37	    assert.deepEqual(headingIdsInTab(settingsSource, tab), sections[tab], tab);
    38	  }
    39	});
    40	
    41	test("Devices install step can show macOS and Linux desktop downloads", () => {
    42	  assert.match(settingsSource, /setRemoteInstallerUrls\(data\.installerUrls/);
    43	  assert.match(settingsSource, /Download \{installer\.label\}/);
    44	  assert.match(settingsSource, /Drag the app into Applications/);
    45	  assert.match(settingsSource, /Is it saying .damaged/);
    46	  assert.match(settingsSource, /xattr -cr/);
    47	  assert.match(settingsSource, /desktop-permissions/);
    48	  assert.match(settingsSource, /OS permission check/);
    49	  assert.match(settingsSource, /Grant on Mac/);
    50	});
    51	
    52	test("General settings end with external Website and GitHub links", () => {
    53	  const general = settingsSource.slice(
    54	    settingsSource.indexOf('<TabsContent value="general"'),
    55	    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="general"')),
    56	  );
    57	  assert.ok(general.indexOf('id="settings-links"') > general.indexOf('id="settings-session"'));
    58	  assert.match(general, /href="https:\/\/metis\.f1shy312\.com" target="_blank" rel="noopener noreferrer"/);
    59	  assert.match(general, /href="https:\/\/github\.com\/f1shyondrugs\/metis-ai" target="_blank" rel="noopener noreferrer"/);
    60	});
    61	
    62	test("General settings no longer expose a Default model control", () => {
    63	  assert.doesNotMatch(settingsSource, /Default model/);
    64	  assert.doesNotMatch(settingsSource, /settings-default-model/);
    65	  assert.doesNotMatch(settingsSource, /Choose the model used for new chats/);
    66	});
    67	
    68	test("remote client removal uses the shared confirmation dialog", () => {
    69	  assert.doesNotMatch(settingsSource, /window\.confirm/);
    70	  assert.match(settingsSource, /remoteClientDeleteTarget/);
    71	  assert.match(settingsSource, /title="Remove remote client\?"/);
    72	});
    73	
    74	test("General settings expose the same browser controls as the sidebar", () => {
    75	  const general = settingsSource.slice(
    76	    settingsSource.indexOf('<TabsContent value="general"'),
    77	    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="general"')),
    78	  );
    79	  assert.match(general, /id="settings-browser"/);
    80	  assert.match(general, /<BrowserSettingsControls/);
    81	  assert.match(general, /onChange=\{onBrowserSettingsChange\}/);
    82	  assert.match(general, /browserViewportWidth=\{browserViewportWidth\}/);
    83	  assert.match(general, /browserViewportHeight=\{browserViewportHeight\}/);
    84	  assert.doesNotMatch(general, /Browser settings live in the browser tab/);
    85	});
    86	
    87	test("browser storage uses a dedicated manager instead of an inline origin list on General", () => {
    88	  const general = settingsSource.slice(
    89	    settingsSource.indexOf('<TabsContent value="general"'),
    90	    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="general"')),
    91	  );
    92	  assert.match(general, /id="settings-browser-storage"/);
    93	  assert.match(general, /setSettingsPane\("browser-storage"\)/);
    94	  assert.doesNotMatch(general, /browserStorage\.map/);
    95	  assert.doesNotMatch(general, /filteredBrowserStorage\.map/);
    96	  assert.match(settingsSource, /data-slot="browser-storage-manager"/);
    97	  assert.match(settingsSource, /filteredBrowserStorage\.map/);
    98	  assert.match(settingsSource, /placeholder="Search websites"/);
    99	  assert.match(settingsSource, /"settings-browser-storage": "browser-storage"/);
   100	  assert.match(settingsSource, /const pane = SETTINGS_SECTION_TO_PANE\[item\.id\];/);
   101	});
   102	
   103	test("Models and Agent pack dense features behind settings tiles", () => {
   104	  const models = headingIdsInTab(settingsSource, "models");
   105	  const agent = headingIdsInTab(settingsSource, "agent");
   106	  assert.deepEqual(models, ["settings-usage", "settings-providers", "settings-versions"]);
   107	  assert.deepEqual(agent, ["settings-skills", "settings-modes", "settings-mcp", "settings-memories", "settings-response-instructions"]);
   108	  assert.match(settingsSource, /data-settings-tile=\{id\}/);
   109	  assert.match(settingsSource, /id=\"settings-providers\"/);
   110	  assert.match(settingsSource, /id=\"settings-versions\"/);
   111	  assert.match(settingsSource, /id=\"settings-skills\"/);
   112	  assert.match(settingsSource, /setSettingsPane\("providers"\)/);
   113	  assert.match(settingsSource, /setSettingsPane\("versions"\)/);
   114	  assert.match(settingsSource, /setSettingsPane\("skills"\)/);
   115	  assert.match(settingsSource, /slot="providers-manager"/);
   116	  assert.match(settingsSource, /slot="versions-manager"/);
   117	  assert.match(settingsSource, /slot="skills-manager"/);
   118	  assert.match(settingsSource, /slot="modes-manager"/);
   119	  assert.match(settingsSource, /slot="mcp-manager"/);
   120	  assert.match(settingsSource, /slot="memories-manager"/);
   121	  assert.match(settingsSource, /title="Response instructions"/);
   122	  assert.match(settingsSource, /Give the agent instructions for how it should respond across your chats/);
   123	  assert.match(settingsSource, /setSettingsPane\("response-instructions"\)/);
   124	  assert.match(settingsSource, /data-slot=\{slot\}/);
   125	  const modelsTab = settingsSource.slice(
   126	    settingsSource.indexOf('<TabsContent value="models"'),
   127	    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="models"')),
   128	  );
   129	  assert.match(modelsTab, /<PlanUsagePanel/);
   130	  assert.doesNotMatch(modelsTab, /provider-connection-form/);
   131	  assert.doesNotMatch(modelsTab, /<SkillsSettings/);
   132	});
   133	
   134	test("provider editing stays inside the Models settings tab and OAuth names can be saved without reconnecting", () => {
   135	  const editStart = settingsSource.indexOf("function editProviderConnection");
   136	  const editEnd = settingsSource.indexOf("async function saveProviderConnection", editStart);
   137	  const editBlock = settingsSource.slice(editStart, editEnd);
   138	  assert.match(editBlock, /onSettingsTabChange\("models"\)/);
   139	  assert.doesNotMatch(editBlock, /onSettingsTabChange\("providers"\)/);
   140	
   141	  const oauthControls = settingsSource.slice(
   142	    settingsSource.indexOf('{providerDraft.authType === "oauth" ? ('),
   143	    settingsSource.indexOf(') : (', settingsSource.indexOf('{providerDraft.authType === "oauth" ? (')),
   144	  );
   145	  assert.match(oauthControls, /Save changes/);
   146	  assert.match(oauthControls, /saveProviderConnection/);
   147	  assert.match(oauthControls, /Reconnect OAuth/);
   148	});
