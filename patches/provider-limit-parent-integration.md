# Parent integration

The backend is implemented. This patch is deliberately unapplied: the parent owns `components/app-shell.tsx` and `components/settings-panel.tsx`.

Apply/review `patches/provider-limit-parent-integration.patch`. The parent has concurrently added the settings control and readable stream label, with the correct API URL. This remaining patch hardens that control (typed API data, abortable save, saved notice), retains Stop on a reloaded paused chat, and extends the parent notification observer with one durable limit notification per job/reset. No parent source was edited by this task. It also adds the optional persisted field to `AgentJob` (outside this task's file ownership); runtime code currently uses a local intersection type instead.

## API and state contract

- `GET /api/agent-settings/provider-limit` → `{ enabled: boolean, defaultEnabled: true }`.
- `PATCH /api/agent-settings/provider-limit` with `{ enabled: boolean }`. Account-scoped, authenticated, `private, no-store`; invalid values → 400, unauthenticated → 401.
- Setting applies when a new limit is reached. Existing waiting jobs preserve their durable decision; Stop cancels them through the existing cancellation API.
- Same job remains `queued`, with `providerRateLimit: { resetAt, detectedAt, source }`, preserving job ID, run ID, agent/session binding and checkpoint. This is deferred work, not failed/completed work. No schema migration or sleeping worker is needed.
- Chat projection is `runStatus: "paused"` with a persisted `queueMessage` containing the actual UTC reset time. On restart/reload read that projection and/or `GET /api/runs?chatId=…` for structured metadata.
- Existing run stream emits `status` with `{ status: "waiting_provider_limit", message, resetAt, source }`. Do not synthesize `done`, `error`, completion sounds, or failed badges for this pause. Keep subscribing to the same job ID for automatic resumption. Use `resetAt` to format local time; do not estimate a quota/window from model or tariff.
- Claiming clears the waiting metadata at/after reset and preserves identity. For child/project run budgets, persisted deadlines shift by the actual paused duration so the pause does not consume runtime.

## Evidence and limitations

Reset evidence: typed provider error fields, HTTP Retry-After/reset headers, SDK error causes/body, Claude SDK rejected limit events, explicit unambiguous provider messages, or fresh exhausted Codex native thread telemetry. Unknown/stale/ambiguous reset times keep the existing failure path; no guessed five-hour/seven-day fallback. Billing/auth/permission and unrelated infrastructure errors are not retried. AI SDK's opaque internal retries are disabled in favor of the durable scheduler.

Codex account and OAuth homes are persistent per owner/connection, and native thread IDs are saved at `thread.started`. Claude session IDs are saved during iteration, including failed turns. Cursor already persists its session before sending; usage-limit startup failures must not enter session replacement/recovery branches.

Verification uses temporary SQLite databases, fake Date clocks, a separate reload process, a real runner with a fake provider, authenticated route checks and native telemetry fixtures. No production provider calls, production-data changes, service restarts, commits, pushes or deploys. UI/notification patch not applied or rendered; parent must check mobile/tablet/desktop integration and notification behavior. The patch was generated against the currently changing parent working tree; review context before applying.

The parent has also added a rolling-version compatibility gate: production child processes need `AI_CHAT_PROVIDER_LIMIT_WAITER=1`, now passed by the updated `worker.ts`. Preserve this pairing when integrating; otherwise newly deferred JSON could be claimed immediately by an old scheduler. A focused test covers both unsupported and supported production schedulers. Late failure publication and stale runtime expiry are guarded at the durable job boundary, so a crash during cleanup cannot erase a committed pause.


Shared-tree typecheck currently reports only `components/app-shell.tsx` at the `useAccountNotifications(authed, …)` call: `authed` is `boolean | null`, but the hook requires `boolean`. The unapplied parent patch includes `Boolean(authed)` for that call. No UI file was edited.

Changed files owned by this task (no production execution):

- `lib/db-jobs.ts`
- `lib/worker-runner.ts`
- `lib/providers/runner.ts`
- `lib/providers/adapters/ai-sdk.ts`
- `lib/providers/adapters/claude.ts`
- `lib/providers/adapters/codex.ts`
- `lib/providers/adapters/provider-support.ts`
- `lib/provider-rate-limit.ts`
- `lib/provider-rate-limit-settings.ts`
- `lib/providers/codex-rate-limit.ts`
- `app/api/agent-settings/provider-limit/route.ts`
- `tests/provider-limit-runtime.test.ts`
- `tests/provider-limit-runner.test.ts`
- `tests/provider-limit-settings.test.ts`
- `tests/codex-rate-limit.test.ts`
- `patches/provider-limit-parent-integration.patch`
- `patches/provider-limit-parent-integration.md`

`lib/worker-scheduler.ts` and `lib/worker-failure.ts` needed no edits; their existing behavior is covered by the targeted regression tests. Concurrent parent changes (including the worker capability flag and UI/notifications) are not attributed to this task.
