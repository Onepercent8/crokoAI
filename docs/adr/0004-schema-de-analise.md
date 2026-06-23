# ADR 0004 — Schema de análise

- **Status:** accepted
- **Data:** 2026-06-22
- **Onda:** 1 (estrutura) · 4 (uso)

## Contexto

A análise diária (Onda 4) é read-only sobre a Meta e precisa persistir, de forma consultável pelo
dashboard: um cabeçalho por execução, métricas por entidade e por nível (campanha/ad set/ad), os
diagnósticos (findings) e o funil de conversão de 7 etapas. Queríamos evitar uma tabela "larga"
única (muitas colunas esparsas, difícil de evoluir) e manter rastreabilidade do payload bruto.

## Decisão

Vamos modelar a análise como **um cabeçalho `analyses` com três filhos**:
`metric_snapshots` (uma linha por entidade×nível, com `raw jsonb` do payload da Meta),
`analysis_findings` (diagnósticos com severidade/evidência/recomendação) e
`funnel_events` (7 etapas com CVR por etapa, `level` incluindo `account`). Verdes/severidades são
enums com CHECK. Dinheiro em centavos; métricas de razão (`ctr`, `cvr_*`) em `numeric`.

## Consequências

- **+** Cabeçalho leve + filhos especializados → consultas do dashboard simples e índices focados.
- **+** `raw jsonb` preserva o payload da Meta para auditoria/reprocessamento.
- **+** Funil isolado em `funnel_events` permite evoluir as 7 etapas sem mexer nas métricas.
- **−** Uma análise = várias inserções (1 + N + M + 7×entidade); escrita em lote na Onda 4.
- **−** Enums via CHECK exigem migration para adicionar valor novo (aceitável: domínio estável).
