#!/usr/bin/env bash
# run-skill.sh — executor de UMA skill headless (SPEC flyio-cron-campaign-runner).
#
# Segurança (ordem obrigatória): authz (allowlist on-disk) -> validação (charset
# dos args) -> lógica. Args são DADOS, não instrução: charset restrito, sem
# shell-metacaracteres. Persistência das skills é REST + SUPABASE_SECRET_KEY
# (NUNCA MCP do Supabase). Telemetria start/end em agent_events via run_id.
#
# Uso: run-skill.sh <skill-slug> [--key value ...]
# Saída: exit code do `claude -p` (0 = ok).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
SKILLS_DIR="${SKILLS_DIR:-$APP_DIR/.claude/skills}"
LOG_DIR="${LOG_DIR:-/data/logs}"
EMIT="${EMIT:-$APP_DIR/scripts/emit-from-stream.py}"

slug="${1:-}"
shift || true

if [[ -z "$slug" ]]; then
  echo "run-skill: missing skill slug" >&2
  exit 64
fi

# --- authz: allowlist por slug, charset restrito, diretório on-disk ----------
# O slug NUNCA é concatenado em caminho a partir de texto livre: validamos o
# charset e exigimos que o diretório exista on-disk.
if [[ ! "$slug" =~ ^[a-z0-9-]+$ ]]; then
  echo "run-skill: invalid skill slug charset: $slug" >&2
  exit 64
fi
skill_dir="$SKILLS_DIR/$slug"
if [[ ! -d "$skill_dir" || ! -f "$skill_dir/SKILL.md" ]]; then
  echo "run-skill: skill not found on disk: $slug" >&2
  exit 65
fi

# --- validação: charset dos args (sem metacaracteres de shell) ---------------
args=()
for a in "$@"; do
  if [[ ! "$a" =~ ^[A-Za-z0-9._:/-]+$ ]] || [[ ${#a} -gt 256 ]]; then
    echo "run-skill: invalid arg charset (rejected)" >&2
    exit 64
  fi
  args+=("$a")
done

run_id="${RUN_ID:-$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)}"
export RUN_ID="$run_id"
export SKILL_SLUG="$slug"
mkdir -p "$LOG_DIR"
log_file="$LOG_DIR/${run_id}-${slug}.log"

# --- telemetria: start -------------------------------------------------------
python3 "$EMIT" --emit-start --run-id "$run_id" --agent-name "$slug" || true

# --- lógica: claude -p headless, stream-json -> tee + emit -------------------
set +e
claude -p "$slug" \
  --dangerously-skip-permissions \
  --output-format stream-json \
  "${args[@]}" \
  2> >(tee -a "$log_file" >&2) \
  | tee -a "$log_file" \
  | python3 "$EMIT" --run-id "$run_id" --agent-name "$slug"
exit_code="${PIPESTATUS[0]}"
set -e

# --- telemetria: end ---------------------------------------------------------
python3 "$EMIT" --emit-end --run-id "$run_id" --agent-name "$slug" --exit-code "$exit_code" || true

exit "$exit_code"
