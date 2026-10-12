import assert from "node:assert/strict";
import test from "node:test";
import { latestPreparingTool, toolPreparationCharacters, toolPreparationTitle } from "../lib/tool-preparation";

test("preparation names the actual tool and MCP transport when available", () => {
  assert.equal(toolPreparationTitle({ name: "execute_command", kind: "shell", source: "mcp" }), "Preparing command · MCP · execute_command");
  assert.equal(toolPreparationTitle({ name: "read_file", kind: "read", source: "mcp" }), "Preparing file read · MCP · read_file");
  assert.equal(toolPreparationTitle({ name: "mcp__github__create_issue" }), "Preparing tool call · MCP · mcp__github__create_issue");
  assert.equal(toolPreparationTitle({ name: "write_file", kind: "edit", source: "native" }), "Preparing file edit · write_file");
  assert.equal(toolPreparationTitle({ name: "tool" }), "Preparing tool call");
});

test("an unknown or invalid count stays absent; zero is a real observation", () => {
  for (const n of [undefined, NaN, Infinity, -1]) assert.equal(toolPreparationCharacters(n), undefined);
  assert.equal(toolPreparationCharacters(0), 0);
  assert.equal(toolPreparationCharacters(3256), 3256);
});

test("the newest pending call is selected without reviving executing or terminal calls", () => {
  const first = {id:"a", name:"read_file", status:"running", phase:"preparing", inputChars:12};
  const current = {id:"b", name:"write_file", status:"running", phase:"preparing", inputChars:0};
  const completed = {id:"c", name:"old_tool", status:"completed", phase:"preparing", inputChars:999};
  const resultArrived = {id:"d", name:"result_tool", status:"running", phase:"preparing", result:""};
  const executing = {id:"e", name:"execute_command", status:"running", phase:"executing", inputChars:99};
  assert.equal(latestPreparingTool([first,current,completed,resultArrived,executing]), current);
  assert.equal(latestPreparingTool([completed,resultArrived,executing]), undefined);
});
