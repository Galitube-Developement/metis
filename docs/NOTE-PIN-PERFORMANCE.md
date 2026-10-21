# Note pinning with many chats

21 October 2026. Prepared locally; no production deployment, Git commit or publication is implied.

## Confirmed bottleneck

The note-oriented PATCH in `app/api/context/pins/route.ts` enumerated every chat, called `getChat()`, and called `updateChat()` even when a chat's pin array did not change. Saving one selected chat therefore parsed, serialized and wrote every history. The GET path also repeatedly looked up pin state and global settings for each chat, and the dialog received/rendered every chat choice.

A synthetic fixture with 400 chats (399 histories of about 64 KiB and one 4 MB history) reproduces synchronous blocking. Authentication and the actual API handler were used, with an isolated database. SQL preparation, canonical writes and JSON parse volume were instrumented; a zero-delay timer measured event-loop blockage. Timings below are one controlled local sample, not a fleet-wide latency guarantee.

| Operation | Before | After |
| --- | ---: | ---: |
| Open picker | 97.54 ms / 2,409 SQL preparations | 11.52 ms / 6 SQL preparations |
| Initial picker response | 17,155 bytes / 400 choices | 2,236 bytes / 50 choices |
| Pin one chat | 1,719.83 ms / 400 canonical writes | 10.66 ms / 1 canonical write |
| Save unchanged selection | 691.69 ms / 400 canonical writes | 7.61 ms / zero canonical writes |
| Enable Everywhere after one explicit selection | 900.77 ms / 400 canonical writes | 10.58 ms / 1 canonical write |
| JSON parsed for one-chat pin | 30,321,888 characters | 2,053 characters |
| Timer delay during one-chat pin | 1,720.02 ms | 11.20 ms |
| Peak benchmark process RSS | 293.57 MiB | 234.81 MiB |

## Changes

- One membership-scoped projection query reads chat titles and pin arrays, joining personal project settings. It avoids one pin/access/settings query per chat.
- The picker sends fifty choices per page, searches on the server, and explicitly loads further choices. Selection survives page/search changes; chat selections are no longer silently truncated to twenty. The existing limit of twenty notes per chat remains.
- Pin writes compare existing and requested state. Only changed chats are updated. SQLite patches the two pin fields without copying messages into JavaScript, re-deriving todos, recording message activity or rebuilding message projections.
- Everywhere is inherited from the account's global setting. Existing redundant explicit pins and exclusions for that note are removed only where necessary; new chats inherit the note without any per-chat write.
- Small changes execute directly. More than eight changed chats, or a selected history above 256 KiB, use the existing bounded serial background worker. Large selected histories still require a SQLite JSON rewrite, but it runs off the web thread.
- Canonical pin fields, the small pin projection and an already-ready page's metadata/revision are updated atomically. Cached full reads invalidate via revisions; member settings remain personal. Existing drafts, goals, other session fields, messages and history order are preserved.
- The dialog aborts obsolete requests, debounces searches, prevents saving before initial state loads, and exposes loading, failure/retry and save errors.

No new data migration or dependency was required. Original pin storage remains compatible with existing readers; global pins retain the established global-setting representation. Actual note content is not edited by pinning.

## Verification

Focused regression coverage includes 400 histories, all picker pages, search, unchanged writes, exact untouched histories, messages/drafts/goals in changed histories, global inheritance and exclusions, more than twenty selected chats, large-chat background writes with responsive unrelated requests/timers, warm-page revision consistency, personal project settings and membership revocation.

The final `verify_work` evidence ledger verified **3/3 claims**: tests/benchmark, responsive dialog behavior, and inactive build/HTTP/live-service/cleanup checks.

**52 relevant regression tests passed, zero failures**, including the existing long-chat, project-setting, shared-context and note-save suites. TypeScript and strict lint for all changed modules passed; `git diff --check` passed.

The final inactive production build is `bVeX8KdCbFA0sEE4NtrYl`. Its 96 snapshotted source hashes match the final source. The original built `server.mjs` was started against the synthetic database on an isolated port: the first picker GET took 113.45 ms including route initialization, the warm GET 19.10 ms, and a single-chat PATCH 23.90 ms. Authenticated GET/PATCH returned 200, unauthenticated GET returned 401, and the built endpoint returned fifty choices and 2,236 response bytes.

The actual NotePinDialog, using the final production CSS and real source API handlers, was checked in the Metis browser at 390, 768 and 1440 pixels. It initially rendered fifty choices without horizontal overflow, explicitly loaded one hundred, searched for Chat 0399, preserved a prior selection across searches, saved successfully, and recovered from an injected 503 via Retry. During an initial load failure, Save remained disabled.

Evidence: `data/tmp/note-pins-{before,after}.json`, `note-pins-{tests,types,lint,build}.log`, `note-pins-build.status`, `note-pins-sources.json`, `note-pins-runtime-proof.json`, and `note-pins-preview/{evidence,requests}.json`. Verification is reproducible through `python3 data/tmp/note-pins-verify.py checks|browser|build` (one argument at a time).

The live slot remains `.next-b`; application, worker and MCP services were not restarted. Only the two verified test server process groups are stopped during cleanup. No production notes, chats or pin settings were used or modified by the fixtures.
