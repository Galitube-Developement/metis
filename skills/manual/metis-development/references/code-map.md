# Shared behavior and repository boundaries

Confirm this map against current source before editing; it is a navigation aid, not a second implementation.

| Concern | Canonical owner and callers |
| --- | --- |
| Skill defaults and package metadata | `lib/skills.ts`; `skills-lock.json`; `lib/skill-files.ts` for safe package browsing |
| Per-turn skill context | `lib/skill-context.ts` → `lib/worker-runner.ts` and `lib/providers/prompt-context.ts`; matching rules in `lib/skill-routing.ts` |
| Provider message payloads | `lib/agent-payload.ts` → worker and `lib/agent-transcript.ts`; preserve their different JSON nesting limits |
| Retrieval text normalization | `lib/text-normalization.ts` → `lib/context-layers.ts` and `lib/knowledge-lifecycle.ts`; selection and capture policies remain separate |
| Thought duration and row styling | `lib/activity-display.ts` → `components/thinking-block.tsx` and `components/timeline/ReasoningBlock.tsx` |
| Fullscreen Escape lifecycle | `components/use-escape-dismiss.ts` → chart, graph, and Mermaid embeds |
| Wrapped text height | `components/use-measured-text-height.ts` → goal banner and queued prompt preview |
| Browser subscriptions | `lib/browser-events.ts` → fullscreen keyboard handling and account preference hooks |
| Admin HTTP guard | `lib/api-auth.ts` → user administration routes; user/execution identity remains in `lib/user-access.ts` |
| MCP HTTP API invocation | `lib/gateway-request.ts` → MCP server API routes; gateway ownership/authorization still lives in `packages/mcp-gateway` and `lib/mcp-core` |
| Constant-time MCP credential comparison | `lib/mcp-core/safe-equal.mjs` → HTTP bearer authorization and trusted session signatures |
| MCP catalog configuration | `lib/mcp-core/registry-configuration.mjs` and `registry-manager.mjs`; `app/api/connections/catalog/route.ts` and `components/connection-catalog.tsx` |

Provider architecture: start with `lib/providers/registry.ts`, `lib/providers/discovery.ts`, `lib/model-params.ts`, and the selected adapter. Job lifecycle: `worker.ts`, `lib/worker-runner.ts`, `lib/db-jobs.ts`; see `docs/WORKER.md`. Public installation/update contracts: `public/install`, `scripts/build-production-slot.sh`, and `docs/RELEASE-TESTING.md`.

Focused regression suites for shared behavior include `tests/shared-helpers.test.ts`, `tests/skill-context.test.ts`, `tests/skills.test.ts`, `tests/skill-packages.test.ts`, `tests/agent-transcript.test.ts`, `tests/context-layers.test.ts`, `tests/knowledge-lifecycle.test.ts`, `tests/mcp-http-auth.test.ts`, and the relevant UI/provider suites. Run through the repository's pinned runtime where required, for example `./run-service.sh node_modules/tsx/dist/cli.mjs --test tests/skill-context.test.ts`.
