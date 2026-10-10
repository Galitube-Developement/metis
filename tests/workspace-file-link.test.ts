import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceFileLink as parse, workspaceFileHref, workspaceFileDirectory } from "../lib/workspace-file-link";
import { toolContractPrompt } from "../lib/agent-control";

test("legacy absolute file paths keep paths and line/column positions", () => {
  assert.deepEqual(parse("/root/xy"), { path: "/root/xy" });
  assert.deepEqual(parse("/home/user/app.ts:42:7"), { path: "/home/user/app.ts", line: 42, column: 7 });
  assert.deepEqual(parse("/Users/noah/My%20Project/app.ts#L20C3"), { path: "/Users/noah/My Project/app.ts", line: 20, column: 3 });
  assert.deepEqual(parse("file:///tmp/readme.md:2"), { path: "/tmp/readme.md", line: 2 });
});

test("explicit file links round trip encoded spaces and filename punctuation", () => {
  for (const path of ["/root/My Project/read me.md", "/app/a#b?.ts", "/data/report:42", "/tmp/100%.txt", "/api/actual-file.txt", "/tmp/äöü.md"]) {
    const location = { path, line: 5, column: 2 };
    assert.deepEqual(parse(workspaceFileHref(location)), location);
  }
});

test("application, uploaded attachment and external links remain web links", () => {
  for (const href of ["/", "/api/uploads/id/image.png", "/api/file-uploads/id/file", "/chats/abc", "/p/noah", "/share/xyz", "/login", "/setup", "/notes", "/projects/abc", "/_next/static/a.js", "https://example.com/root/file.ts", "//example.com/root/a.ts", "mailto:a@example.com", "workspace://plan/abc", "workspace://canvas/abc", "note://abc", "automation://abc", "/%61pi/uploads/image.png", "/docs?view=api", "/docs#chapter"]) {
    assert.equal(parse(href), null, href);
  }
});

test("malformed, executable, remote-host and unsupported drive links never become server files", () => {
  for (const href of [undefined, "", "javascript:alert(1)", "file://another-host/tmp/a", "file:///C:/Users/noah/a.ts", "C:/Users/noah/a.ts", "workspace://file/%zz", "workspace://file/relative.ts", "workspace://file/%2F%2Fhost%2Fa", "workspace://file/%2Ftmp%2Fa%00.ts", "workspace://file/%2Ftmp%2Fa%0A.ts"]) {
    assert.equal(parse(href), null, String(href));
  }
});

test("invalid cursor values cannot become Monaco positions", () => {
  assert.deepEqual(parse("workspace://file/%2Ftmp%2Fa?line=-1&column=0"), { path: "/tmp/a" });
  assert.deepEqual(parse("workspace://file/%2Ftmp%2Fa?line=999999999999999999999"), { path: "/tmp/a" });
  assert.deepEqual(parse("/tmp/a:0"), { path: "/tmp/a" });
});

test("file directories support root and nested folders", () => {
  assert.equal(workspaceFileDirectory("/tmp/a.ts"), "/tmp");
  assert.equal(workspaceFileDirectory("/a.ts"), "/");
});

test("provider-neutral instructions teach file links without treating remote-device paths as server files", () => {
  const prompt = toolContractPrompt({ modeId: "agent", provider: "test" });
  assert.match(prompt, /workspace:\/\/file\/%2Fabsolute%2Fpath\?line=42&column=1/);
  assert.match(prompt, /Opening a file does not change it/);
  assert.match(prompt, /Remote-device files are not server files/);
});
