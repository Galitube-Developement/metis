#!/usr/bin/env bash
# Generate install instructions without publishing or touching Git.
set -euo pipefail
tag="$1"
repo="$2"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || exit 2
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 2
sed "s|@TAG@|$tag|g; s|@REPO@|$repo|g" <<'EOF'

## How to install

These commands install this release, @TAG@, even after a newer release exists.
Run downloads in an empty directory. The bootstrap verifies its platform download.

### Docker

```bash
curl -fsSL https://github.com/@REPO@/releases/download/@TAG@/SHA256SUMS -o SHA256SUMS
curl -fsSL https://github.com/@REPO@/releases/download/@TAG@/metis-docker-install.sh -o metis-docker-install.sh
grep ' metis-docker-install.sh$' SHA256SUMS | (if command -v sha256sum >/dev/null; then sha256sum --check; else shasum -a 256 --check; fi)
bash metis-docker-install.sh --version @TAG@
```

### Linux and macOS

```bash
curl -fsSL https://github.com/@REPO@/releases/download/@TAG@/SHA256SUMS -o SHA256SUMS
curl -fsSL https://github.com/@REPO@/releases/download/@TAG@/metis-install.sh -o metis-install.sh
grep ' metis-install.sh$' SHA256SUMS | (if command -v sha256sum >/dev/null; then sha256sum --check; else shasum -a 256 --check; fi)
bash metis-install.sh --version @TAG@
```

Linux uses Node.js + systemd; macOS uses Node.js + launchd. Add `--docker` for Docker.

### Windows

```powershell
Invoke-WebRequest https://github.com/@REPO@/releases/download/@TAG@/SHA256SUMS -OutFile SHA256SUMS
Invoke-WebRequest https://github.com/@REPO@/releases/download/@TAG@/metis-install.ps1 -OutFile metis-install.ps1
$entries = @(Get-Content SHA256SUMS | Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+metis-install\.ps1$' })
if ($entries.Count -ne 1) { throw "Missing installer checksum." }
$expected = ($entries[0] -split '\s+')[0]
if ((Get-FileHash .\metis-install.ps1 -Algorithm SHA256).Hash -ne $expected) { throw "SHA256 verification failed." }
powershell -NoProfile -ExecutionPolicy Bypass -File .\metis-install.ps1 -Version @TAG@
```

Windows uses the native runtime by default. Add `-Docker` for Docker.

### Source tarball

Download `metis-ai-@TAG@.tar.gz` and verify its entry in SHA256SUMS.
Extract it, copy `.env.example` to `.env`, then run `pnpm install && pnpm build`.

See [CHANGELOG.md](https://github.com/@REPO@/blob/@TAG@/CHANGELOG.md) for the full changelog.
EOF
