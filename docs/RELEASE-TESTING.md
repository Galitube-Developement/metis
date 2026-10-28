# Release and upgrade tests

The supported installation path is native on Linux, macOS and Windows.

## Local contract checks

These checks do not modify a live installation or publish a release:

```bash
pnpm test:release
pnpm exec tsx --test tests/release-manifest.test.ts tests/github-releases.test.ts tests/installer-update.test.ts tests/installers.test.ts tests/installer-dirty-checkout.test.ts
pnpm exec tsc --noEmit --pretty false
```

The release contract checks the stable manifest, native installer dry runs,
rejection of removed installation options, SHA-256 checksums and version-pinned
installation instructions. Run shell syntax checks for both `install/*.sh`
and `public/install/*.sh`.

Native installers preserve configured data directories and existing environment
settings. Production builds use an inactive slot and switch only after success.
They choose a Node heap limit from available memory unless explicitly configured.
Exit code 134 indicates a process abort; inspect the build log to establish its cause.

## Native integration tests

Run real installations and upgrades only in isolated directories with separate
service names and ports. Never stop production Metis for a test.

- Verify the expected version through `/api/system/version`.
- Check web, worker and MCP health and an actual browser JavaScript asset.
- Write a sentinel into the data directory and workspace before upgrading; verify both afterward.
- Verify a failed build keeps the previous build slot and data intact.
- Exercise Windows and macOS on their actual operating systems before claiming coverage.

Existing container installations are not migrated automatically. Install natively
in a separate directory and migrate data in a planned maintenance operation.
Legacy uninstallation and runtime detection remain available to avoid damaging
existing installations.

## Publishing

Commit the package version and changelog first. From a clean, isolated checkout:

```bash
gh auth status
pnpm release vX.Y.Z
```

The release command runs contract checks and the production build, creates an
annotated tag, pushes the commit and tag, then publishes the source archive,
native bootstrap/platform installers and SHA256SUMS. It does not build or publish
container images. GitHub Actions validates builds but does not publish releases.
Download the published files and verify their checksums and source commit.
A force push is not part of normal publishing.
