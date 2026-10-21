# Long chat loading: investigation and implementation

Date: 21 October 2026. Changes are prepared and tested locally; this document does not claim deployment to the reported installation.

## Confirmed cause and limits of the reproduction

The reported 28 MB chat, ten-second timeout, sustained CPU and nearly exhausted 7.7 GB host are observations from another installation. They do not establish a single root cause. This investigation uses synthetic data and isolated databases; no private conversation was copied or modified.

A reproduction contains 301 messages and 400 subagent tools with nested transcripts and duplicate tool parts. Its canonical JSON is 28,968,799 bytes. The pre-change authenticated GET handler was served through a local Node HTTP wrapper with the same authentication, store, compaction and program-event functions as the application. An external Python HTTP client requested the large page and, 15 ms later, a healthcheck and a different small chat. Three cold-cache repetitions and a warm request were measured in the same fixture.

The old request for ten messages returned 26,757,413 bytes. Cold responses took 309–436 ms; the other chat waited 268–386 ms and the healthcheck 269–370 ms. Maximum event-loop delay was 384 ms. Peak process RSS reached 610,529,280 bytes (582 MiB). A larger 41.9 MB variant delayed unrelated requests by 0.6–0.7 seconds.

This confirms synchronous web-thread blockage and oversized responses on this host. It does **not** reproduce the exact ten-second timeout or demonstrate which process exhausted RAM on the reported host. CPU speed, available RAM, GC pressure, polling and client rendering affect the outcome.

The confirmed processing costs were:

- A page cache miss read and parsed the complete canonical chat; todos were derived from the complete history.
- The compactor exempted structured tools, including subagents. Nested transcripts and duplicate tool parts survived into a nominally paginated response.
- Token estimation serialized full tool data again during page preparation.
- Metadata PATCHes, read acknowledgements, runtime/recovery authorization and recovery job enumeration could load large histories during navigation.
- Browser snapshots could retain expanded tool/subagent data and recreate that rendering work on reopening.

## Storage and read path

The original `chats.data` JSON remains canonical and readable by older versions. Additive tables store revision state, individual original messages, compact message previews, individual original tools, compact events and per-message todo results. Pagination uses indexed positions and a byte budget; it does not select the original chat blob and shorten it afterward.

A page starts with ten messages, at most 24 events per message and a 256 KiB preview budget. Text previews have explicit full-text links. Tool input/output, diffs and nested subagent data have authorized detail endpoints. Large handoff details are retrieved when their dialog opens. Message and event cursors expose the remaining data; they do not delete it.

Subagent status polling uses one authorized bulk endpoint, in batches of at most 50 IDs, instead of fetching a message page for every child. Terminal or unavailable children stop polling; navigation aborts pending status requests. The dedicated todo endpoint reads only a todo row, not even a message preview.

Current todos come from the latest indexed successful checklist, including explicit clears. Full-input token estimates are produced when previews are stored, rather than recalculated while reading a page.

Normal message writes update their derived rows in the same transaction. Metadata-only writes preserve message rows. Full replacements and reverts rebuild the projection to match the replacement. Tool detail URLs carry a revision so an expanded running tool can refresh after a checkpoint.

SQLite triggers invalidate the projection for canonical writes, including old-version or external writers and same-timestamp mutations. An old or invalidated large chat is rebuilt off-thread. One worker, a maximum of 16 pending operations, per-chat backfill deduplication and a bounded V8 heap prevent a burst of cold requests from creating one large heap per chat.

The first legacy preparation is deliberately different from an indexed read: it can take longer, but it yields the web event loop and is durable across server restarts. Small legacy records are capped at 64 KiB before any synchronous recovery is permitted. A concurrent write invalidating a preparation causes retry/503; the web route never falls back to parsing a large chat synchronously.

## Data preservation, rollback and recovery

No destructive canonical migration is performed. Rebuilding reads the canonical revision, prepares it in a worker and commits derived rows only if that revision still matches. Projection deletion, insertion and marking the revision ready occur in one transaction. A crash, OOM or interrupted migration leaves the canonical JSON intact; an unfinished projection is retried on the next request.

The added tables and triggers are compatible with rollback: older code continues reading/writing the original chat JSON. A later newer process detects those writes and rebuilds the derived view. Explicit chat deletion cascades to derived rows. Original messages, tool payloads, parent/child job references and ordering are retained.

Derived tables use additional disk space for original message/tool records and previews. They are a read optimization, not a replacement backup. Normal database/WAL backups remain appropriate before a production upgrade.

## Navigation, polling and memory

The browser loads older messages and events only on explicit demand or upward scrolling. Absolute position cursors avoid gaps when new messages append. Subagent views start with a small page and provide older-history controls. Navigation snapshots are capped at ten messages, 24 events and a 256 KiB estimated budget; expanded raw payloads do not enter navigation caches. The IndexedDB cache version invalidates older unbounded snapshots.

Conditional polling uses authenticated private ETags. Both local SQLite changes and external commits invalidate them, including job/handoff status changes without a chat timestamp change. A 304 skips JSON parsing, merging and rendering. Existing visibility and in-flight request guards remain. Full chat caches also use database revisions; sidebar caches observe external commits.

Session PATCH processing runs outside the web event loop. Read acknowledgements avoid JS transcript parsing, message traversal and todo derivation. Runtime/recovery access checks use small access projections. Recovery selects only the latest, live and stale-running job candidates instead of deserializing all completed jobs.

Full-chat cache copies were reduced from 16 entries / 128 MiB to 8 entries / 64 MiB per process. Indexed page reads do not retain full histories in a page cache. The existing worker scheduler already gates admission using host available memory, cgroup/ancestor limits and startup reservations. Tests verify that an almost-full 7.7 GB host admits no additional jobs, regardless of a configured concurrency of 25. No RAM limit was raised. Admission estimates do not impose a hard limit on the later growth of an already-running provider process.

## Validation and measurements

### Final measurements

All figures below use the same 28,968,799-byte canonical fixture. Timings are local HTTP response times, not complete visual page-load times. RSS is peak process memory across the benchmark; it is not total host or worker-fleet consumption.

| Metric | Before | After, durable index already prepared |
| --- | ---: | ---: |
| Large-chat cold requests | 309–436 ms | 5.32–28.45 ms |
| Large-chat warm request | 359.65 ms | 5.78 ms |
| Initial response body | 26,757,413 bytes | 97,030 bytes |
| Concurrent unrelated chat | 268–386 ms | 4.38–15.01 ms |
| Maximum event-loop delay | 383.78 ms | 12.22 ms |
| Peak process RSS | 582.25 MiB | 220 MiB |

The first request to an unprepared legacy chat took 1,965.84 ms, including off-thread projection creation. The concurrent unrelated chat took 15.19 ms and the healthcheck 7.91 ms; peak process RSS during this one-time preparation was 421 MiB. Subsequent reads took 4.82–6.41 ms. Restarting the process retained the index and avoided that preparation.

A separate test launched the **original built `server.mjs`** with the final inactive production slot and an isolated database. After route initialization, forced legacy preparation took 1,975.42 ms while a concurrent unrelated chat took 9.71 ms. Subsequent large-chat requests took 9.86–12.8 ms; their bodies were 97,030 bytes. Authenticated requests returned 200, unauthenticated requests 401, and unchanged conditional requests 304. Cold route/module startup was measured separately, rather than attributed to database pagination.

Real AppShell and SubagentChatView browser checks used the final production CSS at 390, 768 and 1440 pixels: ten initial messages, 24 initial activity events, no horizontal overflow, explicit event pagination (376 remaining → 352), on-demand child history, switching to another chat and back, bounded navigation-cache restoration, and abort/retry after a history URL changes. Bulk status for 48 children was 1,166 bytes; todos were 21 bytes. Completed children did not cause repeated full-child-page requests. No comparative browser time-to-interactive baseline was collected; bounded initial rendering is verified, not a claim of zero browser pauses.

The configured-concurrency-25 memory simulation asserts zero additional admission when a 7.7 GiB host is under pressure, and a startup burst cap of four. Existing provider processes may still grow after admission. Metadata-only writes also remain proportional to canonical SQLite JSON size, although their work no longer runs on the web event loop: browser-fixture PATCHes took approximately 0.6–1.2 seconds. These are explicit limits of this change, not reasons to raise the RAM ceiling.

The final `verify_work` evidence ledger verified **3/3 claims**: regression/data-preservation checks, built HTTP/browser behavior, and build/source/live-service/cleanup/report checks.

Validation: **180 relevant tests passed, zero failures**; TypeScript and strict affected-module lint passed. AppShell lint has eleven pre-existing warnings and zero errors. The inactive production build is `hdyzXiYWXUFRKPchJFozx`; its 92 snapshotted source hashes match the checked files. No production services, release, Git commit or push were performed. A real ten-hour wall-clock soak and the reported installation's exact timeout were not reproduced.

Reproducible evidence is under `data/tmp/`: `long-chat-before-28.json`, `long-chat-after-28.json`, `long-chat-after-28-indexed.json`, `long-chat-runtime-proof.json`, `long-chat-runtime-startup.json`, `long-chat-preview/{evidence,requests}.json`, `long-chat-{tests,types,lint,shell-lint,build}.{log,status}`, `long-chat-memory-check.log` and `long-chat-sources.json`. The authenticated source-handler benchmark and built-Next-server test are separate experiments. Final evidence checks are executable with `python3 data/tmp/long-chat-verify.py checks|runtime|build` (choose one argument).

The large regression fixture additionally persists 400 child jobs and verifies their parent relationships, preservation of canonical JSON, access control, on-demand full tool retrieval, all 400 activity events, cursor order during append, todos outside the visible page, same-timestamp external invalidation, conditional polls, metadata updates and deletion cleanup. A main-thread JSON parser guard rejects attempts to parse a large transcript during initial HTTP loading. Other requests and timers must remain responsive while legacy preparation runs.

An exploratory run also exposed a pre-existing stale source assertion in `tests/tool-group-live-open.test.ts:16`: it requires a `locked={false}` prop that is absent in the repository HEAD. It is unrelated to this implementation and was not changed to make the performance suite pass. Relevant behavioral and storage regressions are run separately.
