# Changelog

All notable Metis AI releases are documented here. Release tags and GitHub
releases are created locally with `pnpm release`; GitHub Actions does not
publish releases.

## v1.0.8 — 2026-09-20

- Insert voice transcripts into the focused mobile composer instead of dropping them after transcription.
- Paint the recording waveform outside React so chat messages do not re-render at 60fps.
- Cap client chat snapshots at 8 and skip cache writes while a run is streaming.

## v1.0.7 — 2026-09-20

- Keep interleaved text between tool groups in chat instead of collapsing every
  tool call to the bottom of the message.
- Type `docker-urls` so the production build can import it.
- Default the Linux installer to native systemd; use `--docker` for Compose.
- Expose the sidebar browser settings (workspace, realtime, FPS, viewport) on
  Settings → General.
- Fix Docker so `.env` bind/host changes apply, stop the MCP restart loop, and
  add `reload.sh` (`reload.ps1` on Windows) because `docker compose restart`
  does not recreate published ports.

## v1.0.6 — 2026-09-17

- Persist composer drafts, agent-generated chat titles, and explicit-only memories.
- Let users lock chat titles so agents cannot overwrite them.
- Keep the chat view stable after completion and reconcile the sending device
  with the durable server snapshot.
- Persist automation model options, restyle the split view, and improve live
  chat plus remote editing.
- Improve browser loading, streaming rendering, and long-chat performance.
- Harden network access, production checks, native Next updates, updater health
  checks, version selection, and persisted update jobs.
- Move release publishing to the local account-based workflow; GitHub Actions
  no longer publishes releases.
- Fix context usage leaking across model/context-tier switches and start native
  sessions fresh with compacted recovery context when required.
- Fix Codex runs hanging after the last visible token.
- Preserve provider output after compaction.
- Publish Docker, Linux/macOS, Windows, native, and source installers on the
  GitHub release so each user can install the way they want.
- Print `You can change this. Add: <install-dir>/.env` under the Open URL after
  install.
- Install Chromium with native installers and let the UI install the browser
  when it is missing.

## v1.0.5 — 2026-09-12

- Improved browser loading and streaming performance.
- Kept Codex sessions from hanging after the last visible token.
- Improved updater health checks and version handling.

## v1.0.4 — 2026-09-12

- Added the versioned updater and installer release flow.
- Stabilized native Next updates and production slot replacement.

## v1.0.3 — 2026-09-12

- Improved updater and release metadata handling.
- Added safer persistence for runtime jobs and sessions.

## v1.0.2 — 2026-09-12

- Improved release versioning and installer metadata.
- Tightened production build and update checks.

## v1.0.1 — 2026-09-12

- Isolated updater tests from GitHub Actions environment variables.

## v1.0.0 — 2026-09-05

- Established the versioned release and updater pipeline.
- Added versioned Docker and native installer assets.
