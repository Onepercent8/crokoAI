#!/usr/bin/env bash
# poll-autonomous-watches.sh — poller do modo autônomo do Nexus (SPEC-013).
#
# Ciclo: lock(mkdir) -> claim_autonomous_watch(worker) -> autonomous-watch-tick
# (≤1 narração, avança 1 fase, idempotente por cursores) -> libera lock. O trap
# garante que um crash NUNCA deixa um watch "claimado" preso: se morrermos após
# o claim sem completar o tick, limpamos o claim para o próximo tick reprocessar
# de forma idempotente. Cadência ~90s (supercronic), 1 watch por tick.
#
# Persistência via REST + SUPABASE_SECRET_KEY (service_role) — NUNCA o MCP do
# Supabase (SPEC-000 §10). Comunicação SÓ via banco; sem superfície HTTP.
set -Eeuo pipefail

LOCK_DIR="${WATCH_LOCK_DIR:-/tmp/autonomous-watch.lock}"
APP_DIR="${APP_DIR:-/app}"
SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_SECRET_KEY="${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY is required}"
WORKER="${FLY_MACHINE_ID:-watch-local}"

# --- lock de instância: mkdir é atômico => 1 execução por vez ----------------
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "watch-poll: another tick holds the lock; exiting (no-op)" >&2
  exit 0
fi

WATCH_ID=""

rest() { # rest METHOD PATH [BODY]
  local method="$1" path="$2" body="${3:-}"
  curl -fsS -X "$method" "${SUPABASE_URL%/}/rest/v1/${path}" \
    -H "apikey: $SUPABASE_SECRET_KEY" \
    -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    ${body:+--data "$body"}
}

release_claim() { # release_claim <watch-id>
  # Idempotente: zera o claim para o watch voltar à fila (não muda a fase).
  rest PATCH "autonomous_watches?id=eq.$1" '{"claimed_by":null,"claimed_at":null}' >/dev/null || true
}

cleanup() {
  local rc=$?
  # Trap: se morremos após o claim sem finalizar, libera o claim (idempotência
  # por cursores garante que o reprocessamento não duplica narração nem fase).
  if [[ -n "$WATCH_ID" && $rc -ne 0 ]]; then
    release_claim "$WATCH_ID"
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- claim atômico: claim_autonomous_watch (FOR UPDATE SKIP LOCKED) ----------
claimed="$(rest POST "rpc/claim_autonomous_watch" "{\"worker\":\"$WORKER\"}" || echo 'null')"
if [[ -z "$claimed" || "$claimed" == "null" || "$claimed" == "[]" ]]; then
  echo "watch-poll: no active watch" >&2
  exit 0
fi

WATCH_ID="$(printf '%s' "$claimed" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d.get("id",""))')"
if [[ -z "$WATCH_ID" ]]; then
  echo "watch-poll: claimed row had no id" >&2
  exit 0
fi

# --- tick: avança 1 fase, insere ≤1 narração (lógica em autonomous-mode.ts) ---
set +e
node "$APP_DIR/scripts/autonomous-watch-tick.cjs" "$WATCH_ID" "$WORKER"
exit_code=$?
set -e

if [[ $exit_code -ne 0 ]]; then
  echo "watch-poll: tick exited $exit_code; releasing claim for retry" >&2
  release_claim "$WATCH_ID"
fi

# Tick concluído (ou claim liberado): limpa WATCH_ID p/ o trap não re-liberar.
WATCH_ID=""
exit 0
