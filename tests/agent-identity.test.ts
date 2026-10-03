     1	import { readFileSync } from "node:fs";
     2	import path from "node:path";
     3	import { fileURLToPath } from "node:url";
     4	import test from "node:test";
     5	import assert from "node:assert/strict";
     6	import { metisAgentIdentity } from "../lib/agent-identity";
     7	
     8	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
     9	
    10	test("identity prompt names Metis AI and the harness", () => {
    11	  const identity = metisAgentIdentity();
    12	  assert.match(identity, /^You are Metis AI\./);
    13	  assert.match(identity, /application harness/);
    14	  assert.match(identity, /not a generic Cursor assistant/);
    15	  assert.match(identity, /remote-client connection are your own runtime/);
    16	  assert.match(identity, /metis-ai-e2e/);
    17	});
    18	
    19	test("cursor and provider runtimes inject the shared identity through their canonical prompt builders", () => {
    20	  const worker = readFileSync(path.join(root, "lib", "worker-runner.ts"), "utf8");
    21	  const promptContext = readFileSync(path.join(root, "lib", "providers", "prompt-context.ts"), "utf8");
    22	  const providerSupport = readFileSync(path.join(root, "lib", "providers", "adapters", "provider-support.ts"), "utf8");
    23	  const modes = readFileSync(path.join(root, "lib", "modes.ts"), "utf8");
    24	  assert.match(worker, /import \{ metisAgentIdentity \} from "@\/lib\/agent-identity"/);
    25	  assert.match(worker, /metisAgentIdentity\(\),/);
    26	  assert.match(promptContext, /import \{ metisAgentIdentity \} from "@\/lib\/agent-identity"/);
    27	  assert.match(promptContext, /return\s+\[[\s\S]*?metisAgentIdentity\(\),/);
    28	  assert.match(providerSupport, /buildProviderPrompt\(/);
    29	  assert.match(promptContext, /responseInstructions/);
    30	  assert.match(promptContext, /User response instructions/);
    31	  assert.match(modes, /You are Metis AI, running in the Metis AI harness/);
    32	  assert.doesNotMatch(promptContext, /You are a provider inside a private AI chat application/);
    33	});
