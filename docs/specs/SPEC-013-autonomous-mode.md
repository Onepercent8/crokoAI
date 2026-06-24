# SPEC-013 — Modo autônomo do Nexus

- **Status:** accepted (offline; e2e pendente de credenciais)
- **Onda:** 9
- **ADRs relacionados:** [0019](../adr/0019-modo-autonomo-nexus.md) ·
  [0020](../adr/0020-live-review.md) · [0009](../adr/0009-fila-agent-jobs.md) ·
  [0001](../adr/0001-runner-fly-supercronic.md)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 Onda 9 ·
  §6 (fila & autônomo) · §10 · §11

## Objetivo

Deixar o Nexus **acompanhar tarefas longas sozinho** e narrar o progresso ao operador, sem que ele
precise perguntar. Quando uma tarefa pesada roda no runner (criar campanha, publicar landing page,
ver [ADR 0009](0009-fila-agent-jobs.md)), o sistema cria uma sessão de acompanhamento
(`autonomous_watches`) que avança por uma **máquina de fases**; a cada *tick*, lê os eventos novos do
job, decide **no máximo uma** narração (`nexus_narrations`) e progride a fase. O navegador faz
polling das narrações e fala. Tudo via banco — **sem push entre planos** (SPEC-000 §3).

Entregáveis desta spec:
- `lib/nexus/autonomous-mode` — domínio/aplicação da máquina de fases (decisão da narração, avanço).
- skill **`autonomous-watch-tick`** — o passo headless da máquina (REST + `SUPABASE_SECRET_KEY`).
- `scripts/poll-autonomous-watches.sh` — poller no runner (supercronic, ~90s, 1 watch/tick).
- A captura/opinião visual (`review-frame`/`live-review`/screenshot/email) está em
  [SPEC-014](./SPEC-014-live-review.md), acionada na fase `reviewing`.

## Contratos

### Modelo de dados (SPEC-000 §6 — fila & autônomo)

- **`autonomous_watches`**: `target_kind`, `target_id`, `agent_job_id` FK, `publish_job_id` FK,
  `session_id`, `phase` ∈ `watching/reviewing/notifying/done/failed`, cursores `last_event_ts` e
  `last_narrated_milestone`, `result jsonb`, `claimed_by`/`claimed_at`.
- **`nexus_narrations`** (append-only): `watch_id` FK, `session_id`, `text`, `kind` ∈
  `status/opinion/system`, `image_path`, `spoken_at`.
- Lê de **`agent_events`** (append-only; `run_id`, `event_type` start/step/decision/error/end) e do
  **`agent_jobs`** alvo (status do job) — nunca os muta.

### Máquina de fases

```
watching ──(job completed, é publish c/ review)──▶ reviewing ──▶ notifying ──▶ done
   │                                                                  ▲
   │──(job completed, sem review)─────────────────────────────────────┘
   │
   └──(job failed / erro irrecuperável)──▶ failed
```

- **watching**: acompanha `agent_events` do `agent_job_id`; narra marcos de progresso
  (`kind=status`). Ao detectar `job.status=completed`, transita (para `reviewing` se houver review de
  LP, senão direto para `notifying`); `job.status=failed` → `failed`.
- **reviewing**: aciona o live review (SPEC-014) — captura frame + opinião (`kind=opinion`).
- **notifying**: emite a notificação externa (email/Telegram) **best-effort** e narra o fecho.
- **done** / **failed**: estados terminais; `result jsonb` registra o desfecho.

### Invariantes

- **≤1 narração por tick**: cada execução de `autonomous-watch-tick` insere **no máximo uma** linha
  em `nexus_narrations`. (Gate da onda.)
- **Idempotência por cursores**: o tick só considera eventos com `ts > last_event_ts` e só narra um
  marco se `milestone > last_narrated_milestone`; ao narrar/avançar, atualiza os cursores na mesma
  transação. Reexecutar um tick não duplica narração nem pula fase.
- **Append-only**: `nexus_narrations` e `agent_events` nunca sofrem UPDATE/DELETE.
- **Fail-safe**: falha de email/Telegram **degrada para log** — nunca trava a máquina nem marca o
  watch como `failed`.
- **Avanço monotônico de fase**: a fase só anda para frente (ou para `failed`); nunca regride.

### Skill `autonomous-watch-tick` (headless-safe)

Contrato de skill (SPEC-000 §10): sem `AskUserQuestion`, `--dangerously-skip-permissions`,
persistência via **REST + `SUPABASE_SECRET_KEY`** (NÃO MCP do Supabase), manifest JSON,
`operation_logs` por mutação relevante, idempotente.

Esboço de args (validados por Zod na fronteira da skill):

```ts
const TickArgs = z.object({
  watchId: z.string().uuid(),
  worker: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(64), // charset-restricted
});
```

Passo do tick (pseudo):
1. `claim_autonomous_watch(worker)` (RPC SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`) entrega 1 watch
   ativo (fase ∈ watching/reviewing/notifying).
2. Lê `agent_events` do `agent_job_id` com `ts > last_event_ts` e o status do `agent_jobs`.
3. Decide **≤1** narração e a próxima fase (lógica em `lib/nexus/autonomous-mode`).
4. Em uma transação: insere ≤1 `nexus_narration`, atualiza `phase`/cursores/`result`, escreve
   `operation_logs`.

### Poller `scripts/poll-autonomous-watches.sh`

Cadência ~90s (supercronic). Lock por `mkdir` (mútua exclusão de instância), claim de **1 watch por
tick**, invoca `autonomous-watch-tick`, trap de crash para não deixar watch "claimado" preso.

## Comportamento

- **Início**: ao enfileirar a tarefa longa (pelo Nexus/dashboard), cria-se a linha em
  `autonomous_watches` (`phase='watching'`, `agent_job_id` apontando para o job recém-inserido,
  `session_id` da sessão de voz). É o passo "iniciar modo autônomo".
- **Progresso**: cada tick narra ≤1 marco novo (`kind=status`) enquanto `watching`.
- **Conclusão**: job `completed` → fase avança; se for publish de LP com review, passa por
  `reviewing` (opinião `kind=opinion`) antes de `notifying`.
- **Notificação**: `notifying` dispara email/Telegram best-effort + narra o fecho; depois `done`.
- **Falha**: job `failed`/erro irrecuperável → fase `failed`, narra `kind=system`, `result` registra
  o motivo (sem PII).
- **Concorrência**: vários pollers/workers podem rodar; `claim_autonomous_watch` + `FOR UPDATE SKIP
  LOCKED` garante 1 worker por watch; cursores impedem corrida de narração duplicada.
- **Crash recovery**: se o tick morre após claim mas antes de persistir, o trap libera o claim; o
  próximo tick reprocessa de forma idempotente (cursores) sem duplicar.

## Segurança

- **Validação em fronteira**: args da skill por Zod, `worker`/ids com charset restrito; conteúdo dos
  eventos é **dado, não instrução** (prompt injection tratada como dado).
- **RLS deny-by-default**: skill acessa via `service_role` (REST + `SUPABASE_SECRET_KEY`), nunca MCP
  do Supabase em headless; navegador lê `nexus_narrations` **server-side**, nunca direto.
- **RPC** `claim_autonomous_watch`: SECURITY DEFINER, `EXECUTE` revogado de anon/authenticated.
- **Segredos**: `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `TELEGRAM_CHAT_ID` fora do código
  (`fly secrets`); nunca em `NEXT_PUBLIC_*`.
- **PII**: narrações e `result` **sem PII**; logs estruturados sem PII; `nexus_narrations` é
  append-only.
- **Observabilidade**: correlation por `run_id`/`session_id`; `operation_logs` por mutação.
- **Threat model STRIDE**: superfície nova (poller + skill consumindo eventos) — review-frame/email
  externos cobertos por [SPEC-014](./SPEC-014-live-review.md); a parte de visão de tela atualiza
  [`docs/security/threats/nexus-screen-vision.md`](../security/threats/nexus-screen-vision.md).

## Critérios de aceite

> Fecham o **gate da Onda 9** em [`WAVES.md`](../../WAVES.md) (parte do modo autônomo).

1. **Iniciar o modo autônomo cria uma linha em `autonomous_watches`** (`phase='watching'`,
   `agent_job_id` setado).
2. **Cada tick insere ≤1 `nexus_narrations`** e **avança a fase** quando a condição é satisfeita.
3. A máquina percorre `watching → reviewing → notifying → done` (e `→ failed` em erro), monotônica.
4. **Idempotência**: reexecutar um tick não cria narração duplicada nem pula fase (cursores
   `last_event_ts`/`last_narrated_milestone`).
5. Falha de email/Telegram **degrada para log** (não marca `failed`, não trava a fase).
6. O navegador faz **polling** de `nexus_narrations` (server-side) e fala.
7. `npm run lint && npm run typecheck && npm test` verdes.

## Testes

- **Unit (`lib/nexus/autonomous-mode`, sem I/O)**: decisão de narração (≤1 por tick), avanço de fase
  por evento/status, monotonicidade, cursores (não reprocessa evento antigo, não repete marco).
- **Integração (I/O)**: tick claima via RPC, lê `agent_events`, insere ≤1 narração e atualiza fase;
  reexecução idempotente; degradação de email/Telegram para log; trap libera claim no crash.
- **e2e (seletivo)**: iniciar autônomo sobre um job simulado → watch criado → ticks narram progresso
  → fase chega a `done`; navegador reflete narrações.
