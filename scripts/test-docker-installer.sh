#!/usr/bin/env bash
# Exercise the complete release installer in a disposable Compose project.
set -Eeuo pipefail
root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
tag="$1"
mkdir -p "$root/.tmp"
fixture="$(mktemp -d "$root/.tmp/metis-installer-smoke.XXXXXX")"
project="metis-installer-smoke-$(date +%s)-$$"
export COMPOSE_PROJECT_NAME="$project"
compose() { env -u PORT -u MCP_PORT -u AI_CHAT_HOST -u METIS_DATA_DIR -u METIS_WORKSPACE docker compose -p "$project" -f "$fixture/install/docker-compose.yml" --env-file "$fixture/install/.env" "$@"; }
cleanup() {
  result=$?
  if [[ -f "$fixture/install/docker-compose.yml" ]]; then
    (( result == 0 )) || compose logs --tail=30 >&2 || true
    compose down --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf -- "$fixture"
}
trap cleanup EXIT
mkdir "$fixture/bin"
# Isolate only discovery of the unrelated native installation. No systemd mutation is allowed.
printf '#!/bin/sh\nexit 1\n' > "$fixture/bin/systemctl"
chmod 700 "$fixture/bin/systemctl"
installer() {
  env -u PORT -u MCP_PORT -u AI_CHAT_BIND -u AI_CHAT_HOST -u METIS_DATA_DIR -u METIS_WORKSPACE -u METIS_RELEASE_VERSION \
    PATH="$fixture/bin:$PATH" bash "$root/public/install/docker.sh" --version "$tag" \
    --install-dir "$fixture/install" --non-interactive "$@"
}
installer --port 13101 --mcp-port 18788 --data-dir "$fixture/persist data" --workspace "$fixture/workspace"
printf 'preserved\n' > "$fixture/workspace/marker"
printf 'unrelated_config=preserved\n' >> "$fixture/install/.env"
node - "$fixture/install/.metis-release.json" "$tag" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (manifest.tag !== process.argv[3] || !manifest.commit || !manifest.repoDigest?.includes("@sha256:") || manifest.architecture !== process.arch.replace("x64", "amd64")) throw new Error("Incomplete install provenance: " + JSON.stringify(manifest));
console.log("NORMAL_INSTALLER_MANIFEST_OK " + manifest.tag + " " + manifest.architecture);
NODE
# A repeat installation must preserve the existing custom paths, ports and unknown config.
installer
grep -F 'PORT=13101' "$fixture/install/.env"
grep -F 'MCP_PORT=18788' "$fixture/install/.env"
grep -F 'unrelated_config=preserved' "$fixture/install/.env"
grep -F 'preserved' "$fixture/workspace/marker"
compose up -d --force-recreate --wait --wait-timeout 180
grep -F 'preserved' "$fixture/workspace/marker"
echo "NORMAL_INSTALLER_UPGRADE_CONFIG_OK"
echo "NORMAL_INSTALLER_COMPLETE_OK"
