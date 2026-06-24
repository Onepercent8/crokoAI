---
name: autonomous-watch-tick
description: Avança UMA fase do modo autônomo do Nexus para um watch (autonomous_watches). Lê os agent_events novos do job, decide ≤1 narração (nexus_narrations) e progride a fase (watching→reviewing→notifying→done|failed). Idempotente por cursores. Headless-safe.
allowed-tools: Read, Bash
---

# Skill — autonomous-watch-tick (Onda 9)

> Implementa o contrato de [`docs/specs/SPEC-013-autonomous-mode.md`](../../../docs/specs/SPEC-013-autonomous-mode.md)
> (+ [SPEC-014](../../../docs/specs/SPEC-014-live-review.md) para a fase `reviewing`).
> A **lógica pura** da máquina de fases vive em `web/lib/nexus/autonomous-mode.ts`
> (`decideTick`, `assertPlanValid`, cursores) e é testada offline. A skill é o **passo headless**:
> claima 1 watch, lê eventos, computa o plano e persiste **em uma transação lógica** via REST.

## Garantias inegociáveis (gate da onda)

- **≤1 narração por tick.** Cada execução insere **no máximo uma** linha em `nexus_narrations`.
- **Idempotência por cursores.** Só considera `agent_events` com `ts > last_event_ts` e só narra um
  marco se `> last_narrated_milestone`; atualiza os cursores junto com a narração/fase.
- **Avanço monotônico de fase.** A fase só anda para frente (ou para `failed`); nunca regride
  (`assertPlanValid` barra transição ilegal antes de persistir).
- **Fail-safe.** Falha de email/Telegram **degrada para log** — nunca marca o watch `failed` nem
  trava a fase.
- **Sem PII** em narração/`result`/manifest/logs.
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (nunca MCP do Supabase). `nexus_narrations` e
  `agent_events` são **append-only**.
- **Manifest JSON** por execução + `operation_logs` por mutação relevante.

## Entrada (args — validados por Zod na fronteira)

```json
{ "watchId": "uuid (opcional; se ausente, claima o próximo watch ativo)", "worker": "^[a-zA-Z0-9_-]{1,64}$" }
```

## Procedimento

1. Validar args (charset restrito em `worker`).
2. `claim_autonomous_watch(worker)` (RPC SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`) entrega 1
   watch ativo (fase ∈ `watching/reviewing/notifying`). Se nenhum, no-op.
3. Ler o status do `agent_jobs` alvo e os `agent_events` (`ts > last_event_ts`).
4. Se fase `reviewing`: rodar o live review (`scripts/screenshot-page.cjs` com SSRF-guard
   `*.example.com` → upload no bucket privado `nexus-review` → opinião). Falha/bloqueio ⇒ degrada.
5. Se fase `notifying`: tentar `scripts/send-email.cjs` (best-effort). Falha ⇒ log-only.
6. `decideTick(...)` (lógica pura) → plano com **≤1 narração** e próxima fase.
7. Persistir: **insere ≤1** `nexus_narrations`, atualiza `phase`/`last_event_ts`/
   `last_narrated_milestone`/`result`, escreve `operation_logs`.
8. Manifest `tentativas-geracao-de-campanhas/<stamp>-watch-tick.json`.

## Execução

O poller `scripts/poll-autonomous-watches.sh` (supercronic, ~90s, 1 watch/tick) invoca esta skill
em loop. O passo de persistência roda via `node scripts/autonomous-watch-tick.cjs` (CommonJS),
reusando a lógica de `decideTick` compilada/portada — sem `AskUserQuestion`,
`--dangerously-skip-permissions`.

## Pendente para o e2e real

env CrokoAI (REST). `RESEND_API_KEY`/`AUTONOMOUS_NOTIFY_EMAIL` opcionais (ausência ⇒ log-only).
`NEXUS_REVIEW_MODEL` para a opinião visual. Playwright instalado no runner para o screenshot.
