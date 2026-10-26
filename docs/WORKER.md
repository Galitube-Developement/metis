# Durable agent worker

The web service accepts durable jobs at `POST /api/runs`. Jobs and checkpoints
live under `CHAT_DATA_DIR` (default: `data/`). The worker processes up to 25
jobs in parallel at most (`AI_CHAT_WORKER_CONCURRENCY`). Actual admission also respects
available host RAM and the worker's cgroup memory limits, reserving headroom for
the application and OS. Newly started jobs reserve memory for 30 seconds before actual cgroup usage
replaces that estimate, so waiting parent agents leave headroom for children;
under pressure, queued jobs wait and existing agents keep running. Optional
`AI_CHAT_WORKER_MEMORY_PER_JOB_MB` overrides the adaptive per-job reservation
(default at most 1 GiB, scaled down on smaller installations). These reservations
are admission estimates, not per-job hard limits; systemd MemoryMax remains the
last protection against a growing job. The worker also recovers stale
`running` jobs after a process restart.

The worker uses the per-user Cursor SDK connections from Settings → Providers,
the same `CHAT_DATA_DIR`, and the agent workspace settings used by the web
service. Run it manually with:

```sh
node node_modules/tsx/dist/cli.mjs worker.ts
```

Production is a systemd unit (`metis-ai-worker`). **Do not stop or restart it**
as a side effect of a test, sandbox, or docs change. Restart only when the
operator explicitly asks.

## Recovery (current)

Stale `running` jobs are reaped with a **15-minute cutoff** and lease-based
`reapExpiredJobLeases` (BUG-C5). Do not reintroduce “requeue every running job”.

One interactive slot is reserved so heavy browser/MCP jobs cannot take the
whole pool. Jobs use priority classes: interactive `100`, interactive-heavy `60`
(parent/subagent or browser-ish mode), background `10`. The reserved slot skips
heavy and background work (BUG-C3).

Automatic subagent lifecycle reviews run only in delegated chats and registered
project-agent chats. Normal user chats, including project chats in Agent mode,
do not receive synthetic review prompts.

`reconcileSubagentParent` appends the lifecycle-review message with
`appendMessageInTransaction` inside the enqueue transaction. `transaction()`
nests with SAVEPOINT so a nested writer cannot fatal-exit the worker.
## Provider reset waits and transient retries

Settings → Agent → Settings keeps provider reset waits enabled by default. When
an exhausted provider window includes a real future reset time, the same job is
queued until that time and releases its worker slot. Its saved provider session
and checkpoint are retained. Stop cancels the waiting job. An unknown reset time
never becomes an assumed five-hour wait.

Automatic retries for transient provider errors are a separate setting, disabled
by default. When enabled, a run gets at most three additional provider attempts;
its retry count persists, and its worker lease and runtime budget remain in
force. Each retry starts after the failed attempt finishes cleanup and appears
as a collapsible chat event with the provider error details. No user message is
inserted. Usage limits, billing/authentication failures, tool failures and unknown
errors do not use this retry policy.

## Resource limits

The Linux systemd templates provide `MemoryHigh`, `MemoryMax`, and `TasksMax`.
Older or custom units can lack these limits; check the actual deployment with
`systemctl show <service> -p MemoryHigh -p MemoryMax -p TasksMax` rather than
assuming the template is active. Worker admission uses the limits actually
applied to its cgroup, including ancestor limits. Budget shared application,
worker, gateway/command, and unrelated server workloads together.

Full chat copies are capped per process at 8 entries / 64 MiB of estimated
snapshot memory. Indexed page previews replace the full-history page cache;
HTTP reads transfer only the selected preview rows. Oversized copies are not
cached, and evicted history remains available from the durable store. Large
legacy histories are prepared by one bounded background thread. See
[LONG-CHAT-PERFORMANCE.md](./LONG-CHAT-PERFORMANCE.md) for the migration and
performance evidence.
