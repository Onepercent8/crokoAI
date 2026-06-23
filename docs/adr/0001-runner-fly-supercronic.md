# ADR 0001 — Runner em Fly.io com supercronic

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 3

## Contexto

O sistema tem 3 planos de execução decoplados que se comunicam **apenas via banco**
(SPEC-000 §3): Dashboard (Vercel), Runner headless e Postgres (Supabase). As *skills* do
Claude Code (Onda 2+) precisam rodar **headless**, 24/7, em dois regimes:

1. **Por agenda** (cron): criar campanhas, analisar funil, gerar resumo diário.
2. **Por demanda** (fila): jobs que o dashboard/Nexus enfileira em `agent_jobs`.

Requisitos do plano runner (SPEC-000 §3/§8 Onda 3/§10):

- **Sem superfície HTTP pública** (não recebe webhook nem chamada inbound — toda coordenação
  é via banco). Isso elimina uma classe inteira de ameaças de borda.
- Precisa do **Claude Code CLI** instalado e autenticado (OAuth) de forma **persistente** —
  o login não pode se perder a cada deploy/restart da máquina.
- Precisa de um **scheduler** simples dentro do container (não um cron de SO mal observável)
  e de **claim atômico** + **dedup** ao consumir a fila sob concorrência.
- Baixo volume (~1 job/min); custo previsível; região próxima ao banco (sa-east-1) e à Meta.

Alternativas consideradas:

- **Vercel Cron / Functions** para rodar as skills: descartado — funções serverless têm
  limite de tempo e filesystem efêmero; skills de campanha/análise são longas e o Claude Code
  CLI precisa de processo persistente e credencial OAuth no disco. (Vercel Cron permanece em
  uso, mas só para *enfileirar* jobs declarativamente — ADR de dashboard.)
- **Broker dedicado (SQS/RabbitMQ/QStash como transporte primário)**: adicionaria um 4º plano
  e mais segredos sem ganho na escala atual — ver [ADR 0009](0009-fila-agent-jobs.md). QStash
  fica opcional só como gatilho de cron externo.
- **cron de SO (crond/anacron) no container**: funciona, mas `supercronic` é desenhado para
  containers (loga em stdout/stderr, respeita o PID 1, sem MTA, sem assumir relógio de host).
- **GitHub Actions agendado**: efêmero, sem credencial OAuth persistente, sujeito a filas e
  limites do runner compartilhado; ruim para tarefa contínua de produção.

**Risco estrutural a decidir nesta onda — autenticação da Meta em headless.** As skills falam
com a Meta **somente via MCP** (`mcp-meta-ads`), e o MCP é autenticado na vinculação do
connector no Claude Code — **não há token Meta em env** (SPEC-000 §2/§10). O cron roda
`claude -p` sem sessão interativa; **o MCP da Meta via claude.ai pode não estar disponível**
nesse contexto headless. Precisamos registrar como o runner obtém acesso à Meta sem violar
"segredos fora do código" e sem inventar um token novo.

## Decisão

Hospedar o runner numa **máquina Fly.io** (região `gru`, próxima do banco e da Meta),
empacotada num **`Dockerfile`** baseado em `node:22` que instala: o **Claude Code CLI**,
**`supercronic`** (scheduler), `wrangler` (deploy de LP em ondas futuras), `playwright`
(screenshots em ondas futuras) e `tsx` (rodar serializers/TS). O `fly.toml` define a máquina
e monta um **volume persistente** para guardar a credencial OAuth do Claude Code (`~/.claude`),
de modo que o login sobreviva a deploys/restarts. **Sem `[http_service]`** — nenhuma porta
pública exposta.

Dentro do container, **`supercronic` lê o `crontab`** e dispara dois fluxos:

- **Cron de skills agendadas** → `scripts/run-skill.sh <slug> [args...]`.
- **Poller da fila** (1×/min) → `scripts/poll-agent-jobs.sh`, que pega um lock por `mkdir`,
  chama a RPC `claim_agent_job(worker)` (claim atômico, `FOR UPDATE SKIP LOCKED` — ADR 0009),
  resolve o job para um slug de skill via **allowlist server-side**, executa via `run-skill.sh`
  e **patcha o status** (`pending→running→completed|failed`) com **trap** de crash.

`run-skill.sh` valida a skill **on-disk** e o **charset dos args**, roda
`claude -p --dangerously-skip-permissions --output-format stream-json`, faz `tee` do log e
encaminha o stream para `scripts/emit-from-stream.py`, que grava telemetria **start/step/
decision/error/end** em `agent_events` (append-only, com `run_id`). O hook
`.claude/hooks/emit-agent-event.py` emite eventos a partir do próprio ciclo de vida do Claude
Code. Toda persistência é **REST + `SUPABASE_SECRET_KEY`** (NUNCA o MCP do Supabase — §10).

**Decisão sobre a Meta em headless (mitigação do risco):** o acesso à Meta no caminho do cron
depende do connector MCP estar **provisionado na máquina** (configuração MCP montada no volume
persistente, autenticada uma vez de forma fora-de-banda). O contrato das skills é tratar a
**ausência do MCP da Meta como falha controlada**: a skill detecta que a tool Meta não está
disponível, **não** tenta um caminho alternativo com token cru, registra `event_type=error`
em `agent_events` e o job termina `failed` com `error` explicando "Meta MCP indisponível no
runner". **Nunca** introduzir um token Meta em env como atalho. A viabilidade do MCP da Meta
em `claude -p` headless é um **risco aberto** (ver §Consequências e a spec
[`flyio-cron-campaign-runner`](../specs/flyio-cron-campaign-runner.md) §Segurança): se o
connector claude.ai não funcionar no cron, a Onda 3 entrega a infraestrutura de fila/cron/
telemetria com skills **read-only/sem-Meta** verdes, e a resolução do acesso Meta headless
vira pré-requisito explícito das ondas que mutam a conta (2/5).

## Consequências

- **+** Processo persistente com filesystem estável: o Claude Code CLI roda longo e mantém o
  OAuth no volume — sem re-login a cada execução.
- **+** Zero superfície HTTP no runner: nada de webhook/inbound; ataque de borda some
  (alinhado a STRIDE — a única entrada são linhas de `agent_jobs`, já validadas).
- **+** `supercronic` é container-native (logs em stdout, sem MTA, observável via `fly logs`).
- **+** Fila no próprio Postgres (claim atômico + dedup por índice único parcial) sem broker
  adicional (ADR 0009); telemetria unificada em `agent_events`.
- **+** Região `gru` reduz latência ao banco (sa-east-1) e à Meta.
- **−** Estado crítico (OAuth do Claude/config MCP) vive num **volume**: precisa de backup e de
  um procedimento de re-autenticação documentado; perder o volume = re-login manual.
- **−** **Risco aberto:** o MCP da Meta pode não estar disponível em `claude -p` headless. Se
  confirmado, as skills que mutam a Meta (Ondas 2/5) ficam bloqueadas até resolver o acesso
  headless; a Onda 3 ainda entrega valor (cron+fila+telemetria) com skills sem-Meta.
- **−** Polling tem latência (~1 job/min) — aceitável (operação de tráfego, não real-time).
- **−** Acoplamento ao Fly.io (mitigado: é só `Dockerfile` + cron + scripts shell portáveis).
