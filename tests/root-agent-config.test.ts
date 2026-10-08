import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("root agent execution is opt-in even when uid=0 and cwd is under /root", () => {
  for (const [flag, expected] of [[undefined, false], ["", false], ["false", false], ["0", false],
    ["no", false], ["garbage", false], ["true", true], ["1", true]] as const) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "process.getuid = () => 0; const module = await import('./lib/config.ts'); const config = module.config ?? module.default.config; console.log('ROOT_ALLOWED=' + config.allowRootAgents);"], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: "/root", AGENT_CWD: "/root/virtual-metis",
        ...(flag === undefined ? {} : { AI_CHAT_ALLOW_ROOT_AGENTS: flag }) },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, new RegExp(`ROOT_ALLOWED=${expected}`));
  }
});
