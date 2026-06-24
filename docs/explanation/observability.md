# Observabilidade — logs estruturados sem PII + correlation/run ids

> **Tipo (Diátaxis):** Explanation. Por que e como o sistema é observável, e o
> contrato que **toda onda** segue (SPEC-000 §11). Não é um tutorial passo a passo.

## Princípios (SPEC-000 §11)

1. **Logs estruturados, nunca PII.** Todo log é dado de operação (ids, status,
   contadores, durações), nunca conteúdo de cliente (email, telefone, nome, corpo
   de requisição). `lp_events` é espelho **NO-PII** por construção (só flags
   `has_email`/`has_phone`, `utm_*`, `country`, `value`).
2. **Correlation/run id em todo fluxo.** Cada execução carrega um identificador
   que costura os eventos de ponta a ponta — `agent_events.run_id` no runner,
   `action_id`/`sessionId` no Nexus, `event_id`/`landing_page_id` no tracking.
3. **Eventos append-only.** `operation_logs`, `agent_events` e `lp_events` nunca
   sofrem UPDATE (trigger `prevent_mutation()`), garantindo trilha de auditoria e
   não-repúdio (ver `docs/security/threats/supabase-data-layer.md`).
4. **Comunicação só via banco (SPEC-000 §3).** A observabilidade entre planos é o
   próprio banco: o runner escreve `agent_events`/`operation_logs`, o dashboard lê.
   Não há tracing inbound entre planos.

## Sinais por plano

| Plano | Sinal | Correlation id | Onde |
|---|---|---|---|
| **Runner (Fly)** | `agent_events` (start/end), `operation_logs` (1 por mutação), `fly logs` (stdout) | `run_id` (UUID por execução de skill) | `scripts/run-skill.sh`, `scripts/emit-from-stream.py` |
| **Fila** | `agent_jobs` (`pending→running→completed/failed`, `started_at`/`finished_at`/`exit_code`) | `id` do job | `scripts/poll-agent-jobs.sh` |
| **Dashboard (Vercel)** | logs da plataforma (sem PII), métricas do edge/serverless | `sessionId` (operador) | `web/` + `vercel logs` |
| **Nexus** | `nexus_narrations` (append-only), eventos de confirmação | `action_id` (single-use), `sessionId` | `web/lib/nexus/*` |
| **Tracking (Worker)** | `lp_events` (NO-PII), logs do Worker | `event_id` + `landing_page_id` | `worker/track/src/*` |

## O run id (`agent_events.run_id`)

O runner gera um `run_id` (UUID) por execução de skill e o propaga:

- `run-skill.sh` cria o `run_id` (`/proc/sys/kernel/random/uuid`), exporta para o
  ambiente da skill e nomeia o arquivo de log (`<run_id>-<slug>.log`).
- `emit-from-stream.py` lê o `stream-json` do `claude -p` e grava `agent_events`
  de **start** e **end** com esse `run_id` — costurando início, fim e `exit_code`.
- As mutações da skill gravam `operation_logs`; cruzando por `run_id`/janela de
  tempo, reconstrói-se a execução inteira sem PII.

Para correlacionar uma execução: filtre `agent_events` por `run_id`, junte com
`operation_logs` da mesma janela e com a linha de `agent_jobs` que originou o run.

## O que NUNCA logar

- Email, telefone, nome ou qualquer identificador pessoal do lead/cliente.
- Corpo de requisição do dashboard/Nexus, frames de tela, transcrição de voz.
- Segredos (`SUPABASE_SECRET_KEY`, `AUTH_SECRET`, chaves de IA) — nem mascarados.
- IP do visitante das LPs: o Worker usa só **hash** para rate-limit; nunca persiste.

## Lacunas conhecidas (follow-up da Onda 11)

- Não há agregador central de logs/tracing distribuído nesta fase; a observabilidade
  é via banco (`agent_events`/`operation_logs`) + `fly logs`/`vercel logs`. Um sink
  externo (ex.: OpenTelemetry/Logflare) fica para fase posterior.
- Métricas de fluxos críticos (latência de claim→completed, taxa de `failed`) são
  derivadas por consulta a `agent_jobs`/`agent_events`, ainda não materializadas.
- Padronizar um helper de log estruturado (campos fixos: `run_id`, `plane`, `event`,
  `level`) nos planos TS reduziria divergência — recomendado, não bloqueante.
