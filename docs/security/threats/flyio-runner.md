# Threat model (STRIDE) — Runner Fly.io (Onda 3)

- **Superfície:** máquina headless no Fly.io (`fly.toml`, app `meta-ads-agents`) com
  supercronic + poller. **Não expõe porta HTTP** (sem `[http_service]`): a única entrada
  são linhas em `agent_jobs` (polling) e o `crontab`. Executa skills via `claude -p
  --dangerously-skip-permissions`.
- **Spec/ADR:** [flyio-cron-campaign-runner](../../specs/flyio-cron-campaign-runner.md) · [ADR 0001](../../adr/0001-runner-fly-supercronic.md) · [ADR 0009](../../adr/0009-fila-agent-jobs-polling.md)
- **Fonte:** SPEC-000 §8 Onda 3 · §10 (runner) · §11 · `.claude/rules/security.md`

## Ativos

- Credenciais OAuth do Claude Code + config MCP (volume persistente `/data`).
- `SUPABASE_SECRET_KEY` (service_role) usado em REST para claim/patch de jobs e
  persistência das skills.
- Capacidade de mutar a conta Meta (via MCP) — superfície de maior impacto financeiro.
- Segredos: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CLAUDE_API_KEY`/OAuth, `OPENAI_API_KEY`
  — via `fly secrets` (nunca no código nem em `[env]` do `fly.toml`).

## Fronteira / fluxo

`crontab` (supercronic) → `poll-agent-jobs.sh`: **lock (mkdir atômico)** → `claim_agent_job`
(`FOR UPDATE SKIP LOCKED`) → **resolve kind→slug pela allowlist** (`resolve-kind.py`) →
**valida/monta args** (charset restrito, `build-argv.py`) → patch `running` →
`run-skill.sh` (revalida slug on-disk + charset dos args) → `claude -p` → patch
`completed`/`failed`. Trap garante que crash nunca deixa job preso em `running`.

## STRIDE

| Categoria | Ameaça | Mitigação | Onde |
|---|---|---|---|
| **S**poofing | Algo se passar pelo runner para drenar a fila | Acesso à fila só com `SUPABASE_SECRET_KEY` (service_role, server-side em `fly secrets`); sem borda HTTP → nada inbound para forjar; `claim_agent_job` carimba `claimed_by` = `FLY_MACHINE_ID`. | `poll-agent-jobs.sh`, `fly.toml` (sem `[http_service]`) |
| **T**ampering | Job malicioso na fila injetar comando de shell via `kind`/`args` | `kind` resolvido por **allowlist** (`resolve-kind.py`) — desconhecido → `failed`, nunca executa; args validados por **charset restrito** (`^[A-Za-z0-9._:/-]+$`, ≤256) e passados como array (`"${argv[@]}"`), sem `eval`/concatenação em shell; slug nunca concatenado de texto livre. | `resolve-kind.py`, `build-argv.py`, `run-skill.sh` |
| **R**epudiation | Execução de skill sem rastro | `agent_events` com `run_id` (start/end via `emit-from-stream.py`); patch de status com `started_at`/`finished_at`/`exit_code`; `operation_logs` por mutação dentro da skill (append-only). | `run-skill.sh`, `emit-from-stream.py` |
| **I**nfo disclosure | Vazar segredo em log/telemetria | Segredos só em env via `fly secrets` (não em `fly.toml [env]`, que só tem não-segredos); logs vão para stdout (`fly logs`) sem PII; `stream-json` emite eventos sem corpo sensível. | `fly.toml`, `emit-from-stream.py` |
| **D**oS | Fila inundada ou jobs concorrentes corrompendo estado | **Lock por `mkdir`** garante 1 execução por tick; poller processa **1 job/min**; índice único parcial barra job duplicado por (client,kind); `FOR UPDATE SKIP LOCKED` evita contenção. | `poll-agent-jobs.sh`, `agent_jobs` (Onda 1) |
| **E**levation | Skill fora da allowlist rodar; job preso travando a fila | Dupla allowlist (poller `resolve-kind.py` + `run-skill.sh` exige `SKILL.md` on-disk); `trap cleanup` patcha `failed` em crash (libera a fila); `--dangerously-skip-permissions` confinado ao container Fly (least privilege). | `run-skill.sh`, `poll-agent-jobs.sh` (`trap`) |

## Riscos residuais / follow-ups

- `service_role` tem `BYPASSRLS` — comprometer o segredo do runner dá acesso total ao
  banco. Mitigar: rotação periódica via `fly secrets`; volume `/data` com OAuth é alvo de
  alto valor (proteger acesso à máquina Fly).
- `--dangerously-skip-permissions` é necessário para headless mas amplo; o confinamento
  é o container Fly + allowlist de skills + charset de args.
- **Risco aberto (ADR 0001 / NOTES §4):** confirmar que o MCP da Meta autentica em
  `claude -p` headless no cron (não só interativo no claude.ai). Sem isso, a operação real
  não roda — mas também não há mutação Meta indevida (fail-closed).
- Volume persistente guarda credencial OAuth de longa duração; considerar rotação e
  escopo mínimo do token Meta/Claude.
</content>
