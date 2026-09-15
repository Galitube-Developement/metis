# Changelog

All notable Metis AI releases are documented here. Release tags and GitHub
releases are created locally with `pnpm release`; GitHub Actions does not
publish releases.

## Unreleased — changes since v1.0.5

- Improved browser loading, streaming rendering, and long-chat performance.
- Hardened native Next updates, updater health checks, version selection, and
  persisted update jobs.
- Fixed Codex runs hanging after the last visible token.
- Moved release publishing to the local account-based workflow; GitHub Actions
  no longer publishes releases.
- Fixed context usage leaking across model/context-tier switches and made native
  sessions start fresh with compacted recovery context when required.
- Fixed the sending device missing a persisted assistant response after a live
  stream completed; it now reconciles with the durable server snapshot.

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
