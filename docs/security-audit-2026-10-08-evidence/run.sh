#!/usr/bin/env bash
# Isolated audit reproduction. No production env, data, services or provider calls.
set -euo pipefail
audit_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$(id -u)" == 0 ]] || { echo 'Root-case evidence requires a root test host.' >&2; exit 1; }
audit_dir="$(mktemp -d /root/metis-security-recheck-XXXXXX)"
audit_revision=b431efb2632462828e1a7e468932a7e76a50e198
# Pin the evidence even when another run edits or commits the shared checkout.
git -C "$audit_repo" archive "$audit_revision" | tar -x -C "$audit_dir"
echo "AUDIT_REVISION=$audit_revision"
ln -s "$audit_repo/node_modules" "$audit_dir/node_modules"
cp "$audit_repo/docs/security-audit-2026-10-08-evidence/recheck.ts" "$audit_dir/recheck.ts"
cp "$audit_repo/docs/security-audit-2026-10-08-evidence/identity-variants.ts" "$audit_dir/identity-variants.ts"
mkdir -p "$audit_dir/evidence" "$audit_dir/fixture/data" "$audit_dir/fixture/workspace"
cd "$audit_dir"
audit_env=(env -i "PATH=$PATH" HOME=/root "AI_CHAT_ROOT=$audit_dir" AI_CHAT_INTERNAL_ORIGIN=http://127.0.0.1:1)
"${audit_env[@]}" "CHAT_DATA_DIR=$audit_dir/fixture/data" "CHAT_DB_PATH=$audit_dir/fixture/data/chat.sqlite" "AGENT_CWD=$audit_dir/fixture/workspace" "AI_CHAT_MCP_STATE_DIR=$audit_dir/fixture/mcp-state" MCP_BEARER_TOKEN=synthetic-audit-mcp-key-not-production node --import tsx recheck.ts > evidence/recheck.log 2>&1
for variant in disabled-root simulated-nonroot docker-contract; do
 mkdir -p "fixture/$variant/data" "fixture/$variant/workspace"
 docker_flag=0
 [[ "$variant" != docker-contract ]] || docker_flag=1
 "${audit_env[@]}" "CHAT_DATA_DIR=$audit_dir/fixture/$variant/data" "CHAT_DB_PATH=$audit_dir/fixture/$variant/data/chat.sqlite" "AGENT_CWD=$audit_dir/fixture/$variant/workspace" AI_CHAT_ALLOW_ROOT_AGENTS=false "METIS_DOCKER=$docker_flag" node --import tsx identity-variants.ts "$variant" >> evidence/variants.log 2>&1
done
"${audit_env[@]}" "CHAT_DATA_DIR=$audit_dir/fixture/regression-data" "CHAT_DB_PATH=$audit_dir/fixture/regression-data/chat.sqlite" "AGENT_CWD=$audit_dir/fixture/workspace" node --import tsx --test tests/owner-boundary.test.ts tests/performance-persistence.test.ts tests/installer-update.test.ts tests/user-isolation.test.ts > evidence/regressions.log 2>&1
grep -E '^MA|^AUDIT_' evidence/recheck.log
grep -E '^MA' evidence/variants.log
tail -9 evidence/regressions.log
echo "EVIDENCE_DIR=$audit_dir/evidence"
echo AUDIT_ISOLATED_REPRODUCTION_PASS
# Keep only this test's synthetic artifacts for inspection. No resident services.
