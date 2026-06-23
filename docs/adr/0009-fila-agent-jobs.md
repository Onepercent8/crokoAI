# ADR 0009 — Fila `agent_jobs` por polling (sem broker)

- **Status:** accepted
- **Data:** 2026-06-22
- **Onda:** 1 (tabela/RPC) · 3 (poller)

## Contexto

Os planos só se comunicam via banco (SPEC-000 §3): o dashboard/Nexus precisa pedir trabalho ao
runner headless **sem** webhook nem chamada inbound. O volume é baixo (≈1 job/min). Um broker
dedicado (SQS/RabbitMQ/QStash como transporte primário) adicionaria um 4º plano e mais segredos,
sem ganho real nessa escala. Precisamos de claim atômico sob concorrência e de dedup de jobs.

## Decisão

Vamos usar a tabela **`agent_jobs` como fila, consumida por polling**. O produtor (dashboard/Nexus)
insere `{client_id, skill, kind, args, status:'pending', requested_by}`. O runner chama a RPC
`claim_agent_job(worker)` (SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`) que entrega o `pending` mais
antigo a exatamente um worker. **Dedup** por **índices únicos parciais**: ≤1 job ativo
(`status ∈ pending/claimed/running`) por `(client_id, kind)` e por `(landing_page_id, kind)`.
O ciclo de status é `pending → claimed → running → completed|failed|cancelled`.

## Consequências

- **+** Zero infra extra: a fila é o próprio Postgres; nada de broker/segredos adicionais.
- **+** `FOR UPDATE SKIP LOCKED` dá claim atômico e escalável a múltiplos workers.
- **+** Índices únicos parciais previnem trabalho duplicado (ex.: dois "create" para o mesmo cliente).
- **−** Polling tem latência (~1 job/min) — aceitável para o domínio (operação de tráfego, não real-time).
- **−** Sem retry/back-off nativo de broker; o poller da Onda 3 implementa trap/patch de status.
