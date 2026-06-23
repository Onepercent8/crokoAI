---
name: funnel-analytics-cliente-exemplo-campaign
description: Análise diária READ-ONLY do funil de conversão (7 etapas) das campanhas do cliente-exemplo. Grava 1 analyses + N metric_snapshots + findings + 7 funnel_events por entidade (e account) no Supabase via REST. NENHUMA mutação na Meta. Headless-safe.
allowed-tools: Read, Bash, mcp__mcp-meta-ads__list_campaigns, mcp__mcp-meta-ads__list_adsets, mcp__mcp-meta-ads__list_ads, mcp__mcp-meta-ads__get_insights
---

# Skill — funnel-analytics-cliente-exemplo-campaign (Onda 4)

> Implementa o contrato de
> [`docs/specs/meta-ads-funnel-analytics.md`](../../../docs/specs/meta-ads-funnel-analytics.md).
> A lógica pura (funil de 7 etapas, CVRs, verdict, findings) vive em `@template/skill-kit`
> (`domain/funnel.ts`, `domain/verdict.ts`) e a orquestração em
> `application/orchestrate-analytics.ts` (`orchestrateAnalytics`), testada offline com fixtures.

## Garantias inegociáveis

- **READ-ONLY na Meta.** `allowed-tools` só expõe tools de **leitura** (`list_*`, `get_insights`).
  **NENHUM** `create/update/delete/activate/pause`. Esta é a barreira primária do gate.
- **CVR numérica** (razão 0..1); divisão por zero ⇒ `null` (nunca `0`/`NaN`).
- **Sem PII** em logs, manifests, `daily_summaries` — só métricas e flags agregadas.
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (nunca MCP do Supabase). `analyses` append-only.
- **Manifest JSON** por execução + `operation_logs` por write significativo.

## Entrada (args — validados por `FunnelAnalyticsArgsSchema`)

```json
{ "client_slug": "cliente-exemplo", "window_days": 7, "compare_window": true, "triggered_by": "cron" }
```

## Funil canônico (7 etapas, ADR 0025)

`impression → link_click → landing_page_view → view_content → add_to_cart → initiate_checkout →
purchase`. Por entidade (campaign/ad_set/ad) **e** pelo nível `account`: 7 `funnel_events` com
`count`, `value_cents`, `cost_per_event_cents`, `cvr_from_prev`, `cvr_from_top`.

## Procedimento

1. Validar args; resolver `client_slug → clients` (REST).
2. Listar entidades com atividade na janela (MCP **read-only**).
3. `deriveFunnel` por entidade + `aggregateAccount` para o nível `account`.
4. `deriveVerdict` + `deriveFindings` (cada finding cruza ≥2 métricas).
5. Persistir em lote: `analyses` → `metric_snapshots` → `analysis_findings` → `funnel_events`;
   `operation_logs` por write; telemetria `agent_events`.
6. Escrever manifest `tentativas-geracao-de-campanhas/<stamp>-analysis.json`.

## Pendente para o e2e real

MCP `mcp-meta-ads` autenticado (read-only) + env CrokoAI. Sem credenciais, a orquestração é
exercida 100% offline com o `MetaReadPort` fake.
