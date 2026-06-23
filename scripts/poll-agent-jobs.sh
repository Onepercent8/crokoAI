#!/usr/bin/env bash
# poll-agent-jobs.sh — consumidor da fila agent_jobs (SPEC flyio-cron-campaign-runner).
#
# Ciclo: lock(mkdir) -> claim_agent_job(worker) -> resolve kind->slug (allowlist)
# -> patch running -> run-skill.sh -> patch completed|failed. Trap garante que um
# crash NUNCA deixa o job preso em `running`. Persistência via REST +
# SUPABASE_SECRET_KEY (service_role) — NUNCA o MCP do Supabase (SPEC-000 §10).
# Comunicação SÓ via banco; o runner não tem superfície HTTP.
set -Eeuo pipefail

LOCK_DIR="${RUNNER_LOCK_DIR:-/tmp/runner.lock}"
APP_DIR="${APP_DIR:-/app}"
SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_SECRET_KEY="${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY is required}"
WORKER="${FLY_MACHINE_ID:-runner-local}"

# --- lock de instância: mkdir é atômico => 1 execução por vez ----------------
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "poll: another tick holds the lock; exiting (no-op)" >&2
  exit 0
fi

JOB_ID=""
JOB_KIND=""

rest() { # rest METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  curl -fsS -X "$method" "${SUPABASE_URL%/}/rest/v1/${path}" \
    -H "apikey: $SUPABASE_SECRET_KEY" \
    -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    ${body:+--data "$body"}
}

patch_job() { # patch_job <id> <json-body>
  rest PATCH "agent_jobs?id=eq.$1" "$2" >/dev/null || true
}

cleanup() {
  local rc=$?
  # Trap: se morremos após o claim com o job ainda não finalizado, marca failed.
  if [[ -n "$JOB_ID" && $rc -ne 0 ]]; then
    patch_job "$JOB_ID" "{\"status\":\"failed\",\"exit_code\":$rc,\"error\":\"runner aborted (trap)\",\"finished_at\":\"$(date -u +%FT%TZ)\"}"
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- claim atômico: claim_agent_job (FOR UPDATE SKIP LOCKED, ADR 0009) -------
claimed="$(rest POST "rpc/claim_agent_job" "{\"worker\":\"$WORKER\"}" || echo 'null')"
if [[ -z "$claimed" || "$claimed" == "null" || "$claimed" == "[]" ]]; then
  echo "poll: no pending job" >&2
  exit 0
fi

JOB_ID="$(printf '%s' "$claimed" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d.get("id",""))')"
JOB_KIND="$(printf '%s' "$claimed" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d.get("kind",""))')"
JOB_ARGS="$(printf '%s' "$claimed" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(json.dumps(d.get("args",{})))')"

if [[ -z "$JOB_ID" ]]; then
  echo "poll: claimed row had no id" >&2
  exit 0
fi

# --- authz: resolve kind->slug pela allowlist (Python = fonte única) --------
slug="$(APP_DIR="$APP_DIR" python3 "$APP_DIR/scripts/resolve-kind.py" "$JOB_KIND" 2>/dev/null || true)"
if [[ -z "$slug" ]]; then
  patch_job "$JOB_ID" "{\"status\":\"failed\",\"exit_code\":65,\"error\":\"kind not in allowlist: $JOB_KIND\",\"finished_at\":\"$(date -u +%FT%TZ)\"}"
  JOB_ID=""
  exit 0
fi

# --- validação + montagem dos args (charset restrito, fonte única em Python) -
mapfile -t argv < <(printf '%s' "$JOB_ARGS" | python3 "$APP_DIR/scripts/build-argv.py")

patch_job "$JOB_ID" "{\"status\":\"running\",\"started_at\":\"$(date -u +%FT%TZ)\"}"

set +e
"$APP_DIR/scripts/run-skill.sh" "$slug" "${argv[@]}"
exit_code=$?
set -e

if [[ $exit_code -eq 0 ]]; then
  patch_job "$JOB_ID" "{\"status\":\"completed\",\"exit_code\":0,\"finished_at\":\"$(date -u +%FT%TZ)\"}"
else
  patch_job "$JOB_ID" "{\"status\":\"failed\",\"exit_code\":$exit_code,\"error\":\"skill exited non-zero\",\"finished_at\":\"$(date -u +%FT%TZ)\"}"
fi

# Job finalizado: limpa JOB_ID para o trap não re-patchar.
JOB_ID=""
exit 0
