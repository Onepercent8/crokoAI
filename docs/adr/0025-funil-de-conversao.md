# ADR 0025 — Funil de conversão

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 4

## Contexto

Diagnosticar uma campanha Meta exige enxergar **onde** o público cai entre o anúncio e a compra,
não só métricas isoladas (CTR, CPC, CPM). A análise da Onda 4 precisa transformar os dados de
insights da Meta num funil padronizado, comparável entre entidades e ao longo do tempo, e
calculável a partir do que a Meta entrega como `actions`/`action_values` (read-only).

Tensões a resolver:

- **Quais etapas** compõem o funil e em que ordem.
- **Como medir conversão** entre etapas — só etapa-a-etapa, ou também do topo até cada etapa.
- **Onde guardar** o funil sem inflar `metric_snapshots` e mantendo o nível de conta (`account`).
- **Como representar valor/receita** (compras) para alimentar ROAS no diagnóstico, em centavos.

A tabela `funnel_events` já existe (ADR 0004 / SPEC meta-ads-persistence-schema) com `level`
(incluindo `account`), `step_order`, `event_type` (enum das 7 etapas), `count`, `value_cents`,
`cost_per_event_cents`, `cvr_from_prev` e `cvr_from_top`. Esta ADR fixa **a semântica** desses
campos.

## Decisão

Adotamos um **funil canônico de 7 etapas**, na ordem (`step_order` 1→7):

1. `impression` → 2. `link_click` → 3. `landing_page_view` → 4. `view_content` →
5. `add_to_cart` → 6. `initiate_checkout` → 7. `purchase`.

Para **cada entidade analisada** (campaign / ad_set / ad) e para o **nível `account`** agregado,
gravamos **7 linhas** em `funnel_events`, uma por etapa, com:

- `count`: volume da etapa (da Meta `actions`/insights; `0` quando ausente, não `null`).
- `value_cents`: valor monetário associado quando aplicável (sobretudo `purchase`), em **inteiro de
  centavos** (`action_values` × 100, arredondado).
- `cost_per_event_cents`: `spend_cents / count` da etapa (em centavos; `null` se `count = 0`).
- **`cvr_from_prev`**: conversão a partir da etapa imediatamente anterior =
  `count[i] / count[i-1]` (a etapa 1 tem `cvr_from_prev = null`).
- **`cvr_from_top`**: conversão a partir do topo (impressões) = `count[i] / count[1]`.

CVRs são `numeric` (razão 0..1), nunca percentuais string. Divisões por zero resultam em `null`
(não em `0`, para não confundir "sem dado" com "0%"). O funil é **derivado e read-only**: nenhum
valor vem de mutação na Meta.

## Consequências

- **+** Funil padronizado e comparável entre entidades, datas e clientes; alimenta diagnósticos
  que cruzam ≥2 etapas (ex.: bom CTR + baixo `landing_page_view` ⇒ problema de LP/velocidade).
- **+** `cvr_from_prev` localiza o **gargalo** específico; `cvr_from_top` mede a **eficiência
  global** do funil — duas leituras complementares numa só linha.
- **+** `value_cents` em centavos habilita ROAS no diagnóstico sem perda de precisão monetária.
- **+** Isolar o funil em `funnel_events` (vs. colunas em `metric_snapshots`) mantém o snapshot
  enxuto e permite evoluir/anotar etapas sem migration nas métricas.
- **−** 7 linhas por entidade + 7 do `account` aumentam a contagem de inserções por análise
  (escrita em lote; ver ADR 0024).
- **−** O conjunto de etapas é fixo via enum/CHECK: adicionar uma etapa nova (ex.: `lead`) exige
  migration. Aceitável — o funil de e-commerce/infoproduto é estável.
- **−** Etapas que a Meta não reporta na janela ficam com `count = 0` e CVRs `null`; o consumidor
  (dashboard/diagnóstico) precisa tratar `null` como "sem dado".

## Relacionados

- ADR [0004](./0004-schema-de-analise.md) (estrutura `funnel_events`) · ADR
  [0024](./0024-analise-diaria-todas-campanhas.md) (quem grava o funil).
- SPEC [`meta-ads-funnel-analytics`](../specs/meta-ads-funnel-analytics.md) · SPEC-000 §6/§8 Onda 4.
