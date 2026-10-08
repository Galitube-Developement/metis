#!/usr/bin/env bash
# Isolated three-service smoke. Never uses the repository's .env or live services.
set -Eeuo pipefail
root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image="${1:?Usage: test-docker-stack.sh IMAGE [WEB_PORT] [MCP_PORT]}"
web_port="${2:-13100}"
gateway_port="${3:-18787}"
test_root="${METIS_STACK_TEST_ROOT:-$root/.tmp}"
mkdir -p "$test_root"
work_dir="$(mktemp -d "$test_root/metis-stack-smoke.XXXXXX")"
project="metis-changes-smoke-$(date +%s)-$$"
cleanup() {
  result=$?
  if (( result != 0 )); then compose logs --tail=60 >&2 || true; fi
  compose down --remove-orphans >/dev/null 2>&1 || true
  # Containers can create root-owned fixture directories on non-root CI hosts.
  # Only hand the disposable smoke directory back to its original owner.
  if [[ "$(id -u)" != "0" ]]; then
    docker run --rm --network none --user 0:0 --entrypoint /bin/sh \
      --mount "type=bind,src=$work_dir,dst=/smoke-cleanup" "$image" \
      -c 'chown -R "$1:$2" /smoke-cleanup' -- "$(id -u)" "$(id -g)"
  fi
  rm -rf -- "$work_dir"
}
trap cleanup EXIT
mkdir -p "$work_dir/data" "$work_dir/workspace"
# Copy before interpolation so env_file resolves against disposable fixture data.
sed '/    build: \./d' "$root/docker-compose.yml" > "$work_dir/docker-compose.yml"
printf 'services:\n  app:\n    image: %s\n  worker:\n    image: %s\n  mcp:\n    image: %s\n' "$image" "$image" "$image" > "$work_dir/image.yml"
compose() { env -u PORT -u MCP_PORT -u AI_CHAT_HOST -u METIS_DATA_DIR -u METIS_WORKSPACE docker compose --project-name "$project" --project-directory "$work_dir" -f "$work_dir/docker-compose.yml" -f "$work_dir/image.yml" --env-file "$work_dir/.env" "$@"; }
token="$(openssl rand -hex 24)"
cat > "$work_dir/.env" <<EOF
PORT=$web_port
MCP_PORT=$gateway_port
AI_CHAT_HOST=127.0.0.1
METIS_DATA_DIR=$work_dir/data
METIS_WORKSPACE=$work_dir/workspace
METIS_AI_BOOTSTRAP_USERNAME=smoke
METIS_AI_BOOTSTRAP_PASSWORD=isolated-smoke-password
MCP_BEARER_TOKEN=$token
MCP_ENABLE_OPTIONAL_SERVERS=false
MCP_ENABLE_REMOTE_SERVERS=false
EOF
cat > "$work_dir/workspace/stack-smoke.mts" <<'TS'
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getDatabase } from "/app/lib/sqlite.ts";
const db = getDatabase();
const user = db.prepare("SELECT id FROM users WHERE username = ?").get("smoke") as { id: string } | undefined;
if (!user) throw new Error("Bootstrap user missing");
const token = "isolated-smoke-session";
db.prepare("INSERT OR REPLACE INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
  .run(createHash("sha256").update(token).digest("hex"), user.id, "2099-01-01T00:00:00Z");
const headers = { cookie: "ai_chat_auth=" + token, "Content-Type": "application/json" };
const base = "http://127.0.0.1:3100";
const status = await (await fetch(base + "/api/status", { headers })).json();
if (!status.authenticated || !status.worker?.ok || !status.mcp?.ok) throw new Error("Stack health incomplete: " + JSON.stringify(status));
console.log("STACK_HEALTH_OK app worker mcp");
const marker = "/workspace/persistence-marker.txt";
if (!existsSync(marker)) {
  const response = await fetch(base + "/api/notes", { method: "POST", headers, body: JSON.stringify({ scope: "global", title: "Docker persistence", content: "isolated-note" }) });
  if (!response.ok) throw new Error("Note create failed " + response.status);
  writeFileSync(marker, "isolated-workspace");
} else if (readFileSync(marker, "utf8") !== "isolated-workspace") throw new Error("Workspace lost");
const notes = await (await fetch(base + "/api/notes", { headers })).json();
if (!notes.notes?.some((n: { content: string }) => n.content === "isolated-note")) throw new Error("Note not persisted");
console.log("STACK_PERSISTENCE_OK note workspace");
const mcpHeaders = { Authorization: "Bearer " + process.env.MCP_BEARER_TOKEN, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const endpoint = "http://mcp:8787/mcp";
const initialized = await fetch(endpoint, { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "isolated-stack-smoke", version: "1" } } }) });
if (!initialized.ok) throw new Error("MCP initialize failed " + initialized.status);
const sessionId = initialized.headers.get("mcp-session-id");
if (!sessionId) throw new Error("MCP session missing");
const sessionHeaders = { ...mcpHeaders, "mcp-session-id": sessionId };
await fetch(endpoint, { method: "POST", headers: sessionHeaders, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
const response = await fetch(endpoint, { method: "POST", headers: sessionHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
const text = await response.text();
if (!response.ok || !text.includes('"tools"')) throw new Error("Authenticated MCP failed " + response.status + " " + text.slice(0, 250));
console.log("STACK_MCP_AUTH_OK");
TS
compose up -d --wait --wait-timeout 180
for attempt in $(seq 1 30); do
  if compose exec -T app pnpm exec tsx /workspace/stack-smoke.mts > "$work_dir/check.log" 2>&1; then break; fi
  if [[ "$attempt" == 30 ]]; then cat "$work_dir/check.log"; exit 1; fi
  sleep 2
done
cat "$work_dir/check.log"
compose up -d --force-recreate --wait --wait-timeout 180
compose exec -T app pnpm exec tsx /workspace/stack-smoke.mts
echo "DOCKER_STACK_RECREATE_OK"
