# ADR 0024 — Análise diária de todas as campanhas

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 4

## Contexto

A agência é operada por IAs 24/7 (SPEC-000 §1). O operador humano precisa, todo dia, de um
retrato confiável de performance de **todas** as campanhas de cada cliente, sem precisar pedir.
A coleta acontece no runner headless (Fly.io), por cron, sem superfície HTTP (SPEC-000 §3/§8
Onda 3/4). As decisões de mutação (pausar/escalar/criar) são de ondas posteriores (5+); aqui a
análise é **read-only** sobre a Meta.

Pontos de tensão que esta decisão resolve:

- **Escopo da varredura:** analisar uma campanha por vez sob demanda vs. varrer todas as
  campanhas ativas do cliente num passe diário.
- **Granularidade:** persistir só o agregado da conta vs. métricas por entidade e por nível
  (campaign / ad_set / ad), para o dashboard poder detalhar.
- **Acionamento e idempotência:** como garantir que a coleta diária não dispare mutações na Meta
  e que rodar de novo no mesmo dia não polua o histórico nem gaste recursos à toa.
- **Resumo para o operador:** um único cabeçalho legível por cliente/dia para o dashboard e para
  notificação opcional (Telegram), sem PII.

A estrutura de persistência já existe (ADR 0004 / SPEC meta-ads-persistence-schema): cabeçalho
`analyses` com filhos `metric_snapshots`, `analysis_findings` e `funnel_events`, mais
`daily_summaries` para o resumo por dia. Esta ADR decide **como a análise diária usa** essa
estrutura.

## Decisão

Vamos rodar uma **análise diária read-only que varre todas as campanhas ativas de cada cliente**,
materializada por duas skills no runner:

1. **`funnel-analytics-<cliente>-campaign`** — uma execução por análise. Lê a Meta **somente**
   (allowed-tools sem qualquer tool de escrita; ver SPEC-000 §8 Onda 4 e §10), grava
   **1 `analyses`** (cabeçalho com janela, entidades analisadas e `overall_verdict`), **N
   `metric_snapshots`** (uma por entidade × nível, com `raw jsonb`), os **`analysis_findings`**
   (diagnóstico cruzando ≥2 métricas, ancorado no north-star do objetivo) e **7 `funnel_events`
   por entidade** (ADR 0025). Escreve manifest JSON e `operation_logs` por mutação no banco
   (nunca na Meta).
2. **`daily-summary-<cliente>`** — consolida as análises do dia num **upsert** em
   `daily_summaries` (`client_id + summary_date` único): texto legível em `summary` + payload
   consultável em `structured jsonb`. Notificação Telegram é **opcional com fallback log-only**.

Ambas são agendadas por cron no `crontab` do runner (uma cadência diária por cliente). A
varredura cobre todas as campanhas com gasto/impressões na janela; o cabeçalho registra
`entities_analyzed` e `triggered_by` para rastreabilidade.

**Invariantes desta decisão:**

- **Zero mutação Meta.** A análise nunca cria/edita/pausa nada na conta (gate da Onda 4).
- **Append por execução.** Cada run cria um novo `analyses` (histórico imutável); o único UPSERT
  é em `daily_summaries` (uma linha por cliente/dia).
- **Dinheiro em centavos**, IDs da Meta em `text`, sem PII em logs/resumos (SPEC-000 §6/§11).

## Consequências

- **+** Cobertura completa diária sem intervenção humana — o operador encontra o retrato pronto.
- **+** Histórico imutável de `analyses` permite comparar dias/janelas e auditar o que a IA viu.
- **+** Read-only por construção: a superfície da Onda 4 não pode gastar dinheiro nem alterar a
  conta, o que simplifica o threat model (sem STRIDE de mutação Meta nesta onda).
- **+** `daily_summaries` dá ao dashboard/Nexus um ponto único de leitura por cliente/dia.
- **−** Varrer todas as campanhas custa N leituras na Meta por dia (rate limit da API a observar;
  mitigado por cadência diária e por restringir às entidades com atividade na janela).
- **−** Uma análise = escrita em lote (1 + N + findings + 7×entidade); exige tratamento de falha
  parcial (ver SPEC: a execução é abortada e re-tentável, sem deixar análise meio-gravada visível).
- **−** Re-rodar no mesmo dia cria um novo `analyses` (por design, append-only); o dashboard usa o
  mais recente. Apenas `daily_summaries` é desduplicado por `(client_id, summary_date)`.

## Relacionados

- ADR [0004](./0004-schema-de-analise.md) (schema de análise) · ADR [0025](./0025-funil-de-conversao.md)
  (funil) · ADR [0001](./0001-runner-fly-supercronic.md) (runner/cron) · ADR
  [0009](./0009-fila-agent-jobs.md) (fila, quando a análise é disparada por job `kind=analyze`).
- SPEC [`meta-ads-funnel-analytics`](../specs/meta-ads-funnel-analytics.md) · SPEC-000 §6/§8/§10/§11.
