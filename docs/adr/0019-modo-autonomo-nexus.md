# ADR 0019 — Modo autônomo do Nexus

- **Status:** accepted
- **Data:** 2026-06-23
- **Onda:** 9

## Contexto

Tarefas longas do sistema (criar campanha, gerar/publicar landing page) rodam no runner headless
via fila `agent_jobs` (ver [ADR 0009](0009-fila-agent-jobs.md)) e podem levar minutos. O operador,
quando dispara uma dessas tarefas pelo Nexus, fica sem feedback até o job terminar. Queremos que o
Nexus **acompanhe e narre** o progresso sozinho, sem que o operador precise ficar perguntando.

Restrições da arquitetura (SPEC-000 §3): **nenhum webhook ou push entre planos** — o navegador
(dashboard) não pode ser notificado pelo runner; o runner não tem superfície HTTP pública. Logo o
acompanhamento tem de nascer do mesmo padrão de polling sobre o banco que o resto do sistema usa.
Além disso, narrar progresso a partir de `agent_events` (append-only, run_id) exige um processo que
leia eventos novos, decida **uma** fala e a persista de forma idempotente — não pode duplicar
narração nem falar duas vezes o mesmo marco se um tick reprocessar.

Alternativas consideradas: (a) o navegador faz polling direto em `agent_events` e gera a fala no
cliente — descartada porque colocaria lógica de decisão/LLM e segredos no browser e exporia tabela
ao cliente, violando "leituras server-side via service_role"; (b) push via WebSocket/SSE do runner
para o browser — descartada por exigir superfície inbound e quebrar o desacoplamento via banco.

## Decisão

Vamos modelar o acompanhamento como uma **máquina de fases dirigida por banco**, com um *tick*
executado pelo runner e narrações consumidas pelo navegador via polling.

- Uma sessão de acompanhamento é uma linha em **`autonomous_watches`** (`target_kind`/`target_id`,
  `agent_job_id` FK, `publish_job_id` FK, `session_id`, `phase`, cursores `last_event_ts`/
  `last_narrated_milestone`, `result jsonb`).
- A **skill `autonomous-watch-tick`** (headless-safe, REST + `SUPABASE_SECRET_KEY`) é o passo da
  máquina: lê os `agent_events` do job desde `last_event_ts`, decide **no máximo uma** narração,
  insere ≤1 linha em **`nexus_narrations`** e avança a fase. Fases:
  `watching → reviewing → notifying → done` (e `failed`).
- O **`scripts/poll-autonomous-watches.sh`** roda no runner via supercronic, em cadência ~90s,
  claima 1 watch por tick com a RPC `claim_autonomous_watch` (SECURITY DEFINER, `FOR UPDATE SKIP
  LOCKED`) e invoca a skill.
- A **idempotência é por cursores**: `last_event_ts` (não reprocessa evento já lido) e
  `last_narrated_milestone` (não repete a fala de um marco). Reprocessar um tick não cria narração
  duplicada nem pula fase.
- O canal de **notificação degrada com segurança**: email (Resend, via `scripts/send-email.cjs`) e
  Telegram são *best-effort* — falha de envio vira log, nunca trava a máquina nem falha o watch.
- A lógica de decisão e os segredos ficam **server-side/runner**; o navegador só faz polling em
  `nexus_narrations` (server-side via service_role) e fala o texto.

## Consequências

- **+** Reaproveita o padrão de polling/claim já existente (ADR 0009): zero infra nova, mesmo modelo
  mental de concorrência (`FOR UPDATE SKIP LOCKED`, claim por worker).
- **+** Idempotência por cursores torna o tick seguro para reexecução e crash-recovery sem
  narração duplicada — alinhado ao caráter append-only de `nexus_narrations`.
- **+** Mantém o desacoplamento por banco: nenhum push entre planos; segredos e LLM fora do browser.
- **+** Notificação fail-safe: um provedor externo fora do ar não derruba o acompanhamento.
- **−** Latência de narração limitada pela cadência do tick (~90s) — aceitável para supervisão, não
  é tempo real.
- **−** Mais uma máquina de estados para manter consistente com a fila (`agent_jobs`); o mapeamento
  fase↔status do job precisa de cuidado (ver SPEC-013).
- **−** Custo de LLM por tick (decisão da fala) — mitigado por "≤1 narração por tick" e por só
  narrar em mudança de marco.
