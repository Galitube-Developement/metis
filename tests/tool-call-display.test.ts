import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasFromToolPayload,
  compactFileDiff,
  compactToolPreview,
  classifyToolKind,
  hydrateCanvasPreview,
  isToolRunning,
  noteReferencesFromToolPayload,
  enrichToolDisplay,
  layoutAssistantParts,
  planFromToolPayload,
  remoteClientHostnameMap,
  todosFromToolPayload,
  toolCallHeadline,
  toolSourceLabel,
  activityGroupLabel,
 memoryCardFromPayload,
 toolGroupLabel,
  truncateToolText,
  workspaceIdFromLink,
} from "../lib/tool-call-display";
import {
  appendTextMessagePart,
  reconcileMessageParts,
  updateThinkingMessagePart,
  upsertToolMessagePart,
  type MessagePartLike,
} from "../lib/message-parts";

test("MCP badges show the requested server for wrapped and already-normalized calls", () => {
  for (const name of ["call_mcp_tool", "get_issue", "mcp__metis_ai__call_mcp_tool"]) {
    for (const kind of ["other", "read", "mcp"]) {
      assert.equal(toolSourceLabel({name, kind, source:"mcp", input:JSON.stringify({server:"linear",tool:"get_issue",arguments:{id:"OMNI-5"}})}), "linear");
    }
  }
  assert.equal(toolSourceLabel({name:"call_mcp_tool",source:"mcp",input:{server:"github",toolName:"list_issues",arguments:{}}}),"github");
});

test("routing envelopes keep priority over business arguments and retain serialized wrapper support", () => {
  const route={server:"linear",tool:"get_issue",arguments:{server:"database",tool:"query"}};
  assert.equal(toolSourceLabel({name:"call_mcp_tool",source:"mcp",input:route}),"linear");
  assert.equal(route.server,"linear");
  assert.equal(toolSourceLabel({name:"get_issue",source:"mcp",input:JSON.stringify({input:JSON.stringify(route)})}),"linear");
  assert.equal(toolSourceLabel({name:"get_issue",source:"mcp",input:{CallMcpTool:route}}),"linear");
});

test("qualified MCP servers and existing Metis or CLI fallbacks stay distinguishable", () => {
  assert.equal(toolSourceLabel({name:"mcp__linear__get_issue",source:"mcp",kind:"other",input:{server:"database",tool:"query"}}),"linear");
  assert.equal(toolSourceLabel({name:"tools.mcp__github__list_issues",source:"mcp",kind:"read"}),"github");
  assert.equal(toolSourceLabel({name:"mcp__metis_ai__read_file",source:"mcp",kind:"read"}),"Metis");
  assert.equal(toolSourceLabel({name:"read_file",source:"mcp",kind:"read",input:{path:"/tmp/file"}}),"Metis");
  assert.equal(toolSourceLabel({name:"execute_command",source:"native",kind:"shell",input:{server:"database"}}),"CLI");
});

test("ordinary server arguments and malformed input do not invent MCP destinations", () => {
  assert.equal(toolSourceLabel({name:"execute_command",source:"mcp",kind:"shell",input:{server:"database",command:"pwd"}}),"Metis");
  assert.equal(toolSourceLabel({name:"get_issue",input:{server:"linear",tool:"get_issue"}}),null);
  assert.equal(toolSourceLabel({name:"call_mcp_tool",source:"mcp",kind:"mcp",input:'{"server":'}),null);
});

type LayoutTool = { id: string; callId?: string; name?: string; kind?: string; status?: string; input?: string; result?: string; todos?: Array<{ content: string }> };
type ReconcileTool = {
  id: string;
  name: string;
  status: string;
  kind?: string;
  result?: string;
  todos?: Array<{ content: string }>;
};
type ReconcilePart = MessagePartLike<ReconcileTool>;

test("reconciles flat text and tools into a compaction-only message", () => {
  const parts = reconcileMessageParts<ReconcileTool, ReconcilePart>({
    parts: [{ type: "compaction", status: "completed", afterTokens: 12_000 }],
    content: "Final answer",
    tools: [{
      id: "read-1",
      name: "read_file",
      status: "completed",
      result: "file contents",
    }],
  });

  assert.deepEqual(parts.map((part) => part.type), ["compaction", "tool", "text"]);
  assert.equal(parts.filter((part) => part.type === "tool").length, 1);
  assert.equal(parts.filter((part) => part.type === "text").length, 1);
  const finalPart = parts.at(-1);
  assert.equal(finalPart?.type === "text" ? finalPart.content : "", "Final answer");
});

test("keeps complete ordered message parts without duplicating flat projections", () => {
  const original: ReconcilePart[] = [
    { type: "thinking", content: "Checking", done: true, durationMs: 500 },
    { type: "tool", id: "read-1", name: "read_file", status: "completed", result: "ok" },
    { type: "text", content: "Final answer" },
    { type: "compaction", status: "completed", afterTokens: 9_000 },
  ];
  const parts = reconcileMessageParts<ReconcileTool, ReconcilePart>({
    parts: original,
    content: "Final answer",
    thinking: "Checking",
    thinkingDone: true,
    thinkingDurationMs: 500,
    tools: [{ id: "read-1", name: "read_file", status: "completed", result: "ok" }],
  });

  assert.deepEqual(parts, original);
});

test("deduplicates tool updates by stable id and keeps the final todo state", () => {
  const parts = reconcileMessageParts<ReconcileTool, ReconcilePart>({
    parts: [
      { type: "tool", id: "todo-run", name: "write_todos", kind: "todo", status: "running", todos: [{ content: "Old" }] },
      { type: "tool", id: "todo-run", name: "write_todos", kind: "todo", status: "completed", todos: [{ content: "New" }] },
    ],
    content: "",
    tools: [{
      id: "todo-run",
      name: "write_todos",
      kind: "todo",
      status: "completed",
      todos: [{ content: "Final" }],
    }],
  });

  const todos = parts.filter((part) => part.type === "tool");
  assert.equal(todos.length, 1);
  assert.equal(todos[0].status, "completed");
  assert.deepEqual(todos[0].todos, [{ content: "Final" }]);
});

test("preserves thinking, tool, and text event order while extending final text", () => {
  const parts: ReconcilePart[] = [];
  updateThinkingMessagePart<ReconcileTool>(parts, { text: "Reasoning", replace: true });
  appendTextMessagePart<ReconcileTool>(parts, "Answer");
  upsertToolMessagePart<ReconcileTool>(parts, { id: "read-1", name: "read_file", status: "running" });
  upsertToolMessagePart<ReconcileTool>(parts, { id: "read-1", name: "read_file", status: "completed", result: "ok" });
  appendTextMessagePart<ReconcileTool>(parts, " continued");

  const reconciled = reconcileMessageParts<ReconcileTool, ReconcilePart>({
    parts,
    content: "Answer continued",
    tools: [{ id: "read-1", name: "read_file", status: "completed", result: "ok" }],
  });
  assert.deepEqual(reconciled.map((part) => part.type), ["thinking", "text", "tool", "text"]);
  assert.equal(reconciled[0].type === "thinking" ? reconciled[0].done : false, true);
  assert.equal(
    reconciled.filter((part) => part.type === "text").map((part) => part.content).join(""),
    "Answer continued",
  );
});

test("reconcileMessageParts keeps interleaved text and tools when flat content is shorter or glued", () => {
  const original: ReconcilePart[] = [
    { type: "thinking", content: "Checking", done: true },
    { type: "text", content: "Ich suche zuerst, was herd rollback bedeutet, und führe es dann aus." },
    { type: "tool", id: "read-1", name: "read_file", status: "completed", result: "ok" },
    { type: "text", content: "Ich hole den Kontext zu herd rollback." },
    { type: "tool", id: "search-1", name: "repo_search", status: "completed", result: "ok" },
    { type: "text", content: "Force-Push ist durch." },
  ];
  const glued = original
    .filter((part) => part.type === "text")
    .map((part) => part.type === "text" ? part.content : "")
    .join("");
  const parts = reconcileMessageParts<ReconcileTool, ReconcilePart>({
    parts: original,
    content: glued.slice(0, 80),
    thinking: "Checking",
    thinkingDone: true,
    tools: [
      { id: "read-1", name: "read_file", status: "completed", result: "ok" },
      { id: "search-1", name: "repo_search", status: "completed", result: "ok" },
    ],
  });

  assert.deepEqual(
    parts.map((part) => part.type),
    ["thinking", "text", "tool", "text", "tool", "text"],
  );
  assert.equal(
    parts.filter((part) => part.type === "text").map((part) => part.content).join(""),
    glued,
  );
});

test("classifies system context compaction as a tool-like chip", () => {
 assert.equal(classifyToolKind("context_compaction"), "compaction");
});

test("compactToolPreview hides JSON payloads from titles", () => {
  assert.equal(compactToolPreview('{"status":"success","value":{"content":"const x = 1"}}'), undefined);
  assert.equal(compactToolPreview("ls -la src"), "ls -la src");
});

test("toolGroupLabel summarizes Cursor-style file/search/tool counts", () => {
  assert.equal(
    toolGroupLabel([
      { kind: "mcp" },
      { kind: "mcp" },
      { kind: "mcp" },
      { kind: "mcp" },
    ]),
    "4 tools",
  );
  assert.equal(
    toolGroupLabel([
      { name: "read_file", kind: "read" },
      { name: "grep", kind: "read" },
      { name: "search_tools", kind: "mcp" },
    ]),
    "Explored 1 file, 2 searches",
  );
  assert.equal(
    toolGroupLabel([
      { name: "read_file", kind: "read" },
      { name: "list_directory", kind: "read" },
    ]),
    "Explored 2 files",
  );
});

test("isToolRunning recognizes in-flight statuses", () => {
  assert.equal(isToolRunning("running"), true);
  assert.equal(isToolRunning("queued"), true);
  assert.equal(isToolRunning("completed"), false);
});

test("layoutAssistantParts separates glued consecutive sentences", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "text", content: "Remote-Tool-Calls beschriftet werden." },
    { type: "text", content: "Ursachen sind klar." },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "text");
  if (blocks[0]?.type === "text") {
    assert.equal(blocks[0].content, "Remote-Tool-Calls beschriftet werden.\n\nUrsachen sind klar.");
  }
});

test("layoutAssistantParts groups consecutive tools and splits after other content", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "thinking", content: "hmm", done: true },
    { type: "text", content: "I will look that up." },
    { type: "tool", id: "1", name: "search_tools", status: "completed" },
    { type: "text", content: "   " },
    { type: "tool", id: "2", name: "call_mcp_tool", status: "running" },
    { type: "text", content: "Here is the answer." },
  ]);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["thinking", "text", "tools", "text"],
  );
  const tools = blocks[2];
  const reply = blocks[3];
  assert.equal(tools.type, "tools");
  if (tools.type === "tools") {
    assert.deepEqual(tools.tools.map((tool) => tool.id), ["1", "2"]);
  }
  assert.equal(reply.type, "text");
  if (reply.type === "text") {
    assert.equal(reply.content, "Here is the answer.");
  }
});

test("layoutAssistantParts splits activity at assistant text, never at a tool kind", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "1", name: "read_file", kind: "read", status: "completed" },
    { type: "tool", id: "2", name: "grep", kind: "read", status: "completed" },
    { type: "text", content: "Next I will update the task list." },
    { type: "tool", id: "3", name: "write_todos", kind: "todo", status: "completed" },
    { type: "tool", id: "4", name: "edit_file", kind: "edit", status: "completed" },
    { type: "tool", id: "5", name: "shell", kind: "shell", status: "completed" },
    { type: "text", content: "Done." },
    { type: "tool", id: "6", name: "search_tools", kind: "mcp", status: "completed" },
  ]);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["tools", "text", "tools", "text", "tools"],
  );
  assert.deepEqual(
    blocks
      .filter((block) => block.type === "tools")
      .map((block) => block.type === "tools" ? block.tools.map((tool) => tool.id) : []),
    [["1", "2"], ["3", "4", "5"], ["6"]],
  );
});

test("layoutAssistantParts retains distinct plan and task calls in chronological order", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "plan-1", name: "create_plan", kind: "plan", status: "completed", input: "old plan" },
    { type: "tool", id: "todo-1", name: "write_todos", kind: "todo", status: "completed", todos: [{ content: "old task" }] },
    { type: "tool", id: "plan-2", name: "edit_plan", kind: "plan", status: "completed", input: "final plan" },
    { type: "tool", id: "todo-2", name: "write_todos", kind: "todo", status: "completed", todos: [{ content: "final task" }] },
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "tools");
  if (blocks[0]?.type === "tools") {
    assert.deepEqual(blocks[0].tools.map((tool) => tool.id), ["plan-1", "todo-1", "plan-2", "todo-2"]);
  }
});

test("layoutAssistantParts keeps a running intermediate plan out of the finished-plan path", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "plan-running", name: "create_plan", kind: "plan", status: "in_progress", input: '{"content":"Draft"}' },
    { type: "tool", id: "tool-after", name: "read_file", kind: "read", status: "completed" },
  ]);
  const planBlock = blocks.find((block) =>
    block.type === "tools" && block.tools.some((tool) => tool.id === "plan-running"));
  assert.equal(planBlock?.type, "tools");
  if (planBlock?.type === "tools") {
    const plan = planBlock.tools.find((tool) => tool.id === "plan-running");
    assert.equal(plan?.status, "in_progress");
  }
});

test("planFromToolPayload deeply unwraps nested plan responses", () => {
  const plan = planFromToolPayload(JSON.stringify({
    status: "success",
    result: JSON.stringify({
      value: {
        plan: { id: "plan-42", title: "Release plan", content: "Ship it." },
      },
    }),
  }));
  assert.deepEqual(plan, {
    title: "Release plan",
    content: "Ship it.",
    workspaceLink: "workspace://plan/plan-42",
  });
});

test("plan create cards retain the saved workspace link alongside input content", () => {
  const plan = planFromToolPayload(
    JSON.stringify({ title: "Release plan", content: "- [ ] Ship it." }),
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify({
      id: "saved-plan",
      name: "Release plan",
      content: "- [ ] Ship it.",
      workspaceLink: "workspace://plan/saved-plan",
    }) }] }),
  );

  assert.deepEqual(plan, {
    title: "Release plan",
    content: "- [ ] Ship it.",
    workspaceLink: "workspace://plan/saved-plan",
  });
  assert.equal(workspaceIdFromLink(plan?.workspaceLink, "plan"), "saved-plan");
});

test("plan cards prefer saved content and identity over stale input metadata", () => {
  const plan = planFromToolPayload(
    JSON.stringify({ id: "draft", title: "Draft", content: "Old content", workspaceLink: "workspace://plan/draft" }),
    JSON.stringify({ value: { id: "saved", title: "Saved plan", content: "Saved content" } }),
  );

  assert.deepEqual(plan, {
    title: "Saved plan",
    content: "Saved content",
    workspaceLink: "workspace://plan/saved",
  });
});

test("plan edit cards merge sparse saved metadata with the submitted markdown", () => {
  const plan = planFromToolPayload(
    JSON.stringify({ title: "Release plan", content: "Updated plan" }),
    JSON.stringify({ status: "success", value: {
      id: "saved-plan", title: "Plan", content: "", workspaceLink: "workspace://plan/saved-plan",
    } }),
  );

  assert.deepEqual(plan, {
    title: "Release plan",
    content: "Updated plan",
    workspaceLink: "workspace://plan/saved-plan",
  });
});

test("plan cards preserve structured markdown when a tool returns plain status text", () => {
  assert.deepEqual(planFromToolPayload(
    JSON.stringify({ title: "Release plan", content: "Actual plan" }),
    "Saved successfully",
    JSON.stringify({ id: "saved-plan" }),
  ), {
    title: "Release plan",
    content: "Actual plan",
    workspaceLink: "workspace://plan/saved-plan",
  });
  assert.deepEqual(planFromToolPayload(undefined, JSON.stringify({ id: "empty-plan", content: "" })), {
    title: "Plan", content: "", workspaceLink: "workspace://plan/empty-plan",
  });
});

test("canvasFromToolPayload skips empty edit results and keeps input markdown", () => {
  const canvas = canvasFromToolPayload(
    JSON.stringify({
      title: "Kurven: Linear · Parabel · Sinus",
      content: "# Kurven\n\n```graph\n{\"curves\":[]}\n```",
    }),
    JSON.stringify({
      status: "success",
      value: {
        id: "845bcc13-ceb6-47b1-b80e-c65eb65e8b82",
        title: "Canvas",
        content: "",
        workspaceLink: "workspace://canvas/845bcc13-ceb6-47b1-b80e-c65eb65e8b82",
      },
    }),
  );
  assert.equal(canvas?.title, "Kurven: Linear · Parabel · Sinus");
  assert.match(canvas?.content || "", /```graph/);
  assert.equal(canvas?.workspaceLink, "workspace://canvas/845bcc13-ceb6-47b1-b80e-c65eb65e8b82");
});

test("hydrateCanvasPreview prefers live workspace markdown over an empty edit result", () => {
  const preview = hydrateCanvasPreview(
    canvasFromToolPayload(
      JSON.stringify({ title: "Canvas", content: "" }),
      JSON.stringify({
        id: "845bcc13-ceb6-47b1-b80e-c65eb65e8b82",
        content: "",
        workspaceLink: "workspace://canvas/845bcc13-ceb6-47b1-b80e-c65eb65e8b82",
      }),
    ),
    [{
      id: "845bcc13-ceb6-47b1-b80e-c65eb65e8b82",
      type: "canvas",
      name: "Kurven: Linear · Parabel · Sinus",
      content: "# Kurven\n\n```graph\n{\"curves\":[]}\n```",
    }],
  );
  assert.equal(preview?.title, "Kurven: Linear · Parabel · Sinus");
  assert.match(preview?.content || "", /```graph/);
});

test("workspaceIdFromLink reads canvas ids and rejects the other kind", () => {
  assert.equal(
    workspaceIdFromLink("workspace://canvas/845bcc13-ceb6-47b1-b80e-c65eb65e8b82", "canvas"),
    "845bcc13-ceb6-47b1-b80e-c65eb65e8b82",
  );
  assert.equal(
    workspaceIdFromLink("workspace://canvas/845bcc13-ceb6-47b1-b80e-c65eb65e8b82", "plan"),
    undefined,
  );
});

test("layoutAssistantParts preserves task and plan event order", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "todo-final", name: "write_todos", kind: "todo", status: "completed", todos: [{ content: "Ship" }] },
    { type: "tool", id: "plan-final", name: "create_plan", kind: "plan", status: "completed", input: "plan" },
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "tools");
  if (blocks[0]?.type === "tools") {
    assert.deepEqual(blocks[0].tools.map((tool) => tool.kind), ["todo", "plan"]);
  }
});

test("toolCallHeadline uses the local shell command as the title", () => {
  const headline = toolCallHeadline({
    name: "execute_command",
    kind: "shell",
    input: JSON.stringify({ command: "ollama pull x" }),
  });
  assert.equal(headline.title, "Ran ollama pull x");
  assert.equal(headline.remote, undefined);
});

test("toolCallHeadline unwraps call_mcp_tool execute_command on a remote client", () => {
  const headline = toolCallHeadline({
    name: "call_mcp_tool",
    kind: "mcp",
    input: JSON.stringify({
      tool: "execute_command",
      arguments: { command: "ollama pull x", target: "client:abc" },
    }),
    hostnames: { abc: "DESKTOP-PD4H5G9" },
  });
  assert.equal(headline.title, "DESKTOP-PD4H5G9: Ran ollama pull x");
  assert.equal(headline.remote, true);
});

test("toolCallHeadline labels a remote read with hostname and path", () => {
  const headline = toolCallHeadline({
    name: "call_mcp_tool",
    kind: "mcp",
    input: JSON.stringify({
      tool: "read_file",
      arguments: { path: "C:\\Users\\sam\\file.txt", target: "client:abc" },
    }),
    hostnames: { abc: "DESKTOP-PD4H5G9" },
  });
  assert.equal(headline.title, "DESKTOP-PD4H5G9: Read file.txt");
  assert.equal(headline.remote, true);
});

test("toolCallHeadline uses the nested MCP tool name instead of call_mcp_tool", () => {
  const headline = toolCallHeadline({
    name: "call_mcp_tool",
    kind: "mcp",
    input: JSON.stringify({ tool: "search_tools", arguments: { query: "browser" } }),
  });
  assert.equal(headline.title, "Searched MCP tools");
  assert.doesNotMatch(headline.title, /call_mcp_tool/i);
  assert.equal(headline.preview, "browser");
});

test("remoteClientHostnameMap maps client ids and windows pc alias", () => {
  const map = remoteClientHostnameMap([
    { id: "abc", hostname: "DESKTOP-PD4H5G9", os: "windows" },
  ]);
  assert.equal(map.abc, "DESKTOP-PD4H5G9");
  assert.equal(map.pc, "DESKTOP-PD4H5G9");
  assert.equal(
    toolCallHeadline({
      name: "execute_command",
      kind: "mcp",
      input: JSON.stringify({ command: "hostname", target: "pc" }),
      hostnames: map,
    }).title,
    "DESKTOP-PD4H5G9: Ran hostname",
  );
});

test("toolCallHeadline includes read line ranges and grep patterns", () => {
  assert.equal(
    toolCallHeadline({
      name: "read_file",
      kind: "read",
      input: JSON.stringify({ path: "/home/samuel/metis-ai/app/globals.css", offset: 280, limit: 150 }),
    }).title,
    "Read globals.css L280-429",
  );
  assert.equal(
    toolCallHeadline({
      name: "grep",
      kind: "read",
      input: JSON.stringify({ pattern: "toolGroupLabel", path: "/home/samuel/metis-ai" }),
    }).title,
    "Grepped toolGroupLabel",
  );
});

test("automation tools classify as standalone state surfaces", () => {
  assert.equal(classifyToolKind("create_automation"), "automation");
  assert.equal(classifyToolKind("call_mcp_tool", { toolName: "create_automation" }), "automation");
});

test("write_todos classifies as todo for the Tasks card", () => {
  assert.equal(classifyToolKind("write_todos"), "todo");
  assert.equal(classifyToolKind("updateTodos"), "todo");
});

test("todosFromToolPayload reads todo lists from tool JSON", () => {
  const todos = todosFromToolPayload(
    JSON.stringify({
      todos: [
        { id: "1", content: "Fix composer", status: "completed" },
        { content: "Group tool calls", status: "in_progress" },
      ],
    }),
  );
  assert.equal(todos?.length, 2);
  assert.equal(todos?.[0]?.content, "Fix composer");
  assert.equal(todosFromToolPayload('{"status":"ok"}'), undefined);
});

test("call_mcp_tool write_todos unwraps string arguments into a Tasks card", () => {
  const input = JSON.stringify({
    server: "gateway",
    toolName: "write_todos",
    arguments: JSON.stringify({
      todos: [
        { id: "diag", content: "Diagnose", status: "completed" },
        { id: "fix", content: "Fix todos", status: "in_progress" },
      ],
    }),
  });
  const todos = todosFromToolPayload(input);
  assert.equal(todos?.length, 2);
  assert.equal(classifyToolKind("call_mcp_tool", input), "todo");
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "1", name: "call_mcp_tool", kind: "mcp", input, status: "completed" },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "tools");
  if (blocks[0]?.type === "tools") {
    assert.equal(blocks[0].tools[0]?.kind, "todo");
    assert.equal(blocks[0].tools[0]?.todos?.length, 2);
  }
});

test("todosFromToolPayload unwraps Cursor mcp write_todos payloads", () => {
  const todos = todosFromToolPayload(
    JSON.stringify({
      toolName: "write_todos",
      args: {
        todos: [
          { content: "Fix tokens", status: "inProgress" },
        ],
      },
    }),
  );
  assert.equal(todos?.length, 1);
  assert.equal(todos?.[0]?.status, "in_progress");
  assert.equal(classifyToolKind("mcp", {
    toolName: "write_todos",
    args: { todos: [{ content: "Fix tokens", status: "pending" }] },
  }), "todo");
});

test("compactFileDiff shows only the changed hunk", () => {
  const before = ["keep", "old line", "tail"].join("\n");
  const after = ["keep", "new line", "tail"].join("\n");
  const diff = compactFileDiff(before, after, 1);
  assert.match(diff, /^-old line$/m);
  assert.match(diff, /^\+new line$/m);
  assert.equal(diff.includes("Before:"), false);
});

test("truncateToolText keeps head and tail", () => {
  const value = `${"a".repeat(2000)}UNIQUE_MIDDLE${"b".repeat(2000)}`;
  const truncated = truncateToolText(value, 1200);
  assert.ok(truncated.length < value.length);
  assert.match(truncated, /chars omitted/);
  assert.equal(truncated.includes("UNIQUE_MIDDLE"), false);
});

test("activityGroupLabel prefixes thought duration onto tool summaries", () => {
 assert.equal(
 activityGroupLabel(
 [{ name: "read_file", kind: "read" }, { name: "list_directory", kind: "read" }],
 { done: true, durationMs: 3000 },
 ),
 "Thought for 3s — Explored 2 files",
 );
});

test("layoutAssistantParts attaches thinking to the following tool group", () => {
 const blocks = layoutAssistantParts<LayoutTool>([
 { type: "thinking", content: "look around", done: true, durationMs: 2500 },
 { type: "tool", id: "1", name: "read_file", kind: "read", status: "completed" },
 { type: "tool", id: "2", name: "list_directory", kind: "read", status: "completed" },
 ]);
 assert.equal(blocks.length, 1);
 assert.equal(blocks[0]?.type, "tools");
 if (blocks[0]?.type === "tools") {
 assert.equal(blocks[0].tools.length, 2);
 assert.equal(blocks[0].thinking?.content, "look around");
 assert.equal(blocks[0].thinking?.durationMs, 2500);
 }
});

test("layoutAssistantParts groups tasks with following tool activity and thinking", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "thinking", content: "plan next steps", done: true, durationMs: 3000 },
    { type: "tool", id: "1", name: "write_todos", kind: "todo", status: "completed" },
    { type: "tool", id: "2", name: "read_file", kind: "read", status: "completed" },
    { type: "tool", id: "3", name: "list_directory", kind: "read", status: "completed" },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "tools");
  if (blocks[0]?.type === "tools") {
    assert.deepEqual(blocks[0].tools.map(tool => tool.name), ["write_todos", "read_file", "list_directory"]);
    assert.equal(blocks[0].thinking?.durationMs, 3000);
  }
});

test("layoutAssistantParts groups all workspace, automation, note and read calls together", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "plan", name: "create_plan", kind: "plan", status: "completed", input: "plan" },
    { type: "tool", id: "automation", name: "create_automation", kind: "automation", status: "completed" },
    { type: "tool", id: "canvas", name: "create_canvas", kind: "canvas", status: "completed", input: "canvas" },
    { type: "tool", id: "note", name: "create_note", kind: "note", status: "completed" },
    { type: "tool", id: "read", name: "read_file", kind: "read", status: "completed" },
  ]);
  assert.deepEqual(
    blocks.map((block) => block.type === "tools" ? block.tools.map((tool) => tool.kind) : []),
    [["plan", "automation", "canvas", "note", "read"]],
  );
});

test("note calls join neighboring tools in order and retain thinking and failed calls", () => {
  const parts = layoutAssistantParts<LayoutTool>([
    {type:"thinking",content:"Find and save the report",done:true,durationMs:800},
    {type:"tool",id:"list",name:"mcp__metis_ai__list_notes",kind:"mcp",status:"completed"},
    {type:"tool",id:"read",name:"read_file",kind:"read",status:"completed"},
    {type:"tool",id:"create",name:"create_note",kind:"note",status:"completed"},
    {type:"tool",id:"update",name:"update_note",kind:"note",status:"error"},
  ]);
  assert.equal(parts.length,1);
  assert.equal(parts[0].type,"tools");
  if(parts[0].type === "tools") {
    assert.deepEqual(parts[0].tools.map(tool=>tool.id),["list","read","create","update"]);
    assert.equal(parts[0].thinking?.durationMs,800);
    assert.equal(parts[0].tools.at(-1)?.status,"error");
  }
  const enriched=enrichToolDisplay({name:"create_note",kind:"mcp",input:JSON.stringify({title:"Checklist",todos:[{content:"Keep task",status:"pending"}]})});
  assert.equal(enriched.kind,"note");
  assert.equal(enriched.todos,undefined);
});

test("saved note links unwrap MCP responses and list results without guessing from input", () => {
  const note={id:"report one",title:"Report.md"};
  const expected=[{id:"report one",title:"Report",noteLink:"note://report%20one"}];
  assert.deepEqual(noteReferencesFromToolPayload({note}),expected);
  assert.deepEqual(noteReferencesFromToolPayload(JSON.stringify({content:[{type:"text",text:JSON.stringify({note})}]})),expected);
  assert.deepEqual(noteReferencesFromToolPayload({value:{note}}),expected);
  assert.deepEqual(noteReferencesFromToolPayload({structuredContent:{notes:[note,note]}}),expected);
  assert.deepEqual(noteReferencesFromToolPayload({notes:[note,{id:"second",title:"Other"}]}).map(item=>item.id),["report one","second"]);
  for(const result of [undefined,"streaming…",{id:"input-id",title:"Unconfirmed"},{error:"Save failed",note},{isError:true,content:[{type:"text",text:JSON.stringify({note})}]},{note:{id:"bad/id",title:"Invalid"}}]) {
    assert.deepEqual(noteReferencesFromToolPayload(result),[]);
  }
  assert.deepEqual(noteReferencesFromToolPayload({note},"failed"),[]);
});

test("layoutAssistantParts merges live and snapshot copies by call id", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "live", callId: "call-1", name: "read_file", kind: "read", status: "running", input: '{"path":"README.md"}' },
    { type: "tool", id: "snapshot", callId: "call-1", name: "read_file", kind: "read", status: "completed", input: '{"path":"README.md"}', result: "done" },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "tools");
  if (blocks[0]?.type === "tools") {
    assert.equal(blocks[0].tools.length, 1);
    assert.equal(blocks[0].tools[0]?.status, "completed");
    assert.equal(blocks[0].tools[0]?.result, "done");
  }
});

test("layoutAssistantParts includes memory calls in the same activity group", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "thinking", content: "remember this", done: true, durationMs: 1200 },
    { type: "tool", id: "1", name: "add_memory", kind: "memory", status: "completed" },
    { type: "tool", id: "2", name: "read_file", kind: "read", status: "completed" },
    { type: "tool", id: "3", name: "list_directory", kind: "read", status: "completed" },
  ]);
  assert.equal(blocks.length, 1);
  if (blocks[0]?.type === "tools") {
    assert.deepEqual(blocks[0].tools.map(tool => tool.name), ["add_memory", "read_file", "list_directory"]);
    assert.equal(blocks[0].thinking?.content, "remember this");
  }
});

test("memoryCardFromPayload shows saved content instead of raw json", () => {
  const card = memoryCardFromPayload(
    "add_memory",
    JSON.stringify({ content: "Cursor context must stay settable" }),
    JSON.stringify({ memory: { id: "1", content: "Cursor context must stay settable" } }),
  );
  assert.equal(card.title, "Saved Memory");
  assert.equal(card.body, "Cursor context must stay settable");
});

test("memoryCardFromPayload lists memories without dumping json", () => {
  const card = memoryCardFromPayload(
    "list_memories",
    "{}",
    JSON.stringify({ memories: [{ content: "one" }, { content: "two" }] }),
  );
  assert.equal(card.title, "Memories");
  assert.ok(card.body.includes("one"));
  assert.ok(card.body.includes("two"));
  assert.equal(/memories/.test(card.body), false);
});

test("toolGroupLabel counts memory updates", () => {
  assert.equal(
    activityGroupLabel(
      [{ name: "add_memory", kind: "memory" }, { name: "read_file", kind: "read" }],
      { done: true, durationMs: 3000 },
    ),
    "Thought for 3s — Explored 1 file, 1 memory",
  );
});



test("layoutAssistantParts includes task updates in edit activity", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "todo", name: "write_todos", kind: "todo", status: "completed", todos: [{ content: "Ship UI" }] },
    { type: "tool", id: "edit", name: "edit_file", kind: "edit", status: "completed" },
    { type: "tool", id: "shell", name: "execute_command", kind: "shell", status: "completed" },
  ]);
  const toolBlocks = blocks.filter((block) => block.type === "tools");
  assert.equal(toolBlocks.length, 1);
  if (toolBlocks[0]?.type === "tools") assert.deepEqual(toolBlocks[0].tools.map(tool => tool.kind), ["todo", "edit", "shell"]);
});


test("memory acknowledgements fall back to submitted content, including MCP wrappers", () => {
  for (const result of [{ success: true, id: "1" }, { content: [{ type: "text", text: "Saved memory" }] }]) {
    const card = memoryCardFromPayload("call_mcp_tool", {
      tool_name: "add_memory", arguments: { content: "Use English UI labels\nKeep the exact wording." },
    }, result);
    assert.equal(card.title, "Saved Memory");
    assert.equal(card.body, "Use English UI labels\nKeep the exact wording.");
  }
});

test("memory cards prefer stored structured content over submitted content", () => {
  const card = memoryCardFromPayload("edit_memory", { content: "submitted" }, {
    content: [{ type: "text", text: "Memory updated" }],
    structuredContent: { memory: { content: "actually stored" } },
  });
  assert.deepEqual(card, { title: "Updated Memory", body: "actually stored" });
});

test("memory cards unwrap JSON MCP results and preserve complete long content", () => {
  const content = "A durable fact. ".repeat(100);
  assert.equal(memoryCardFromPayload("add_memory", {}, {
    content: [{ type: "text", text: JSON.stringify({ memory: { content } }) }],
  }).body, content.trim());
});

test("memory cards do not show submitted content as a successful failed save", () => {
  assert.deepEqual(memoryCardFromPayload("add_memory", { content: "not saved" }, { error: "Storage unavailable" }),
    { title: "Memory Failed", body: "Storage unavailable" });
});

test("memory cards label all scopes and mutation actions", () => {
  for (const scope of ["chat", "global", "project"]) {
    const label = scope[0].toUpperCase() + scope.slice(1);
    for (const [name, action] of [["add_memory", "Saved"], ["edit_memory", "Updated"], ["delete_memory", "Deleted"]]) {
      assert.equal(memoryCardFromPayload(name, {}, {
        content: [{ type: "text", text: JSON.stringify({ scope, memory: { content: "Stored fact" } }) }],
      }).title, `${action} ${label} Memory`);
    }
    assert.equal(memoryCardFromPayload("list_memories", {}, { scope, memories: [] }).title, `${label} Memories`);
    assert.equal(memoryCardFromPayload("list_memories", {}, { scope, memories: [{ content: "one" }] }).title, `${label} Memory`);
  }
});

test("memory cards prefer effective result scope and unwrap argument scopes", () => {
  assert.equal(memoryCardFromPayload("add_memory", { scope: "global" }, {
    structuredContent: { scope: "project", memory: { content: "fact" } },
  }).title, "Saved Project Memory");
  assert.equal(memoryCardFromPayload("call_mcp_tool", {
    tool_name: "edit_memory", arguments: JSON.stringify({ scope: "chat", content: "fact" }),
  }, { success: true }).title, "Updated Chat Memory");
  assert.equal(memoryCardFromPayload("add_memory", { scope: "global" }, { memory: { scope: "chat", content: "fact" } }).title, "Saved Chat Memory");
  assert.equal(memoryCardFromPayload("add_memory", { scope: "unknown" }, { success: true }).title, "Saved Memory");
  assert.equal(memoryCardFromPayload("add_memory", { content: "the word global in a fact" }, { availableScopes: ["chat", "global"] }).title, "Saved Memory");
});

test("memory cards distinguish pending, terminal and failed scoped operations", () => {
  assert.equal(memoryCardFromPayload("add_memory", { scope: "chat" }, undefined, "running").title, "Saving Chat Memory…");
  assert.equal(memoryCardFromPayload("edit_memory", { scope: "global" }, undefined, "running").title, "Updating Global Memory…");
  assert.equal(memoryCardFromPayload("delete_memory", { scope: "project" }, undefined, "running").title, "Deleting Project Memory…");
  assert.equal(memoryCardFromPayload("list_memories", { scope: "chat" }, undefined, "running").title, "Listing Chat Memories…");
  assert.equal(memoryCardFromPayload("add_memory", { scope: "chat" }, { scope: "chat", success: true }, "running").title, "Saved Chat Memory");
  assert.deepEqual(memoryCardFromPayload("add_memory", { scope: "global", content: "not saved" }, { error: "Unavailable" }), { title: "Global Memory Failed", body: "Unavailable" });
  assert.equal(memoryCardFromPayload("edit_memory", { scope: "project" }, undefined, "error").title, "Project Memory Failed");
  assert.equal(memoryCardFromPayload("add_memory", { scope: "chat" }, { isError: true }).title, "Chat Memory Failed");
});

test("memory list and deletion acknowledgements have accurate empty fallbacks", () => {
  assert.equal(memoryCardFromPayload("list_memories", { content: "irrelevant input" }, { memories: [] }).body, "No memories");
  assert.equal(memoryCardFromPayload("delete_memory", { id: "1" }, { success: true }).body, "Memory deleted");
  assert.equal(memoryCardFromPayload("edit_memory", { id: "1", tags: ["updated"] }, { success: true }).body, "Memory content unavailable");
});
