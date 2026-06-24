---
name: create-sales-cliente-exemplo-campaign
description: Cria uma campanha de VENDAS Meta Ads (OUTCOME_SALES, pixel PURCHASE) para o cliente-exemplo, SEMPRE nascida PAUSED, dentro do teto, reusando os top-N criativos vencedores por compras. OMITE destination_type (Meta v25). Persiste no Supabase via REST. Headless-safe.
allowed-tools: Read, Bash, mcp__mcp-meta-ads__get_insights, mcp__mcp-meta-ads__list_ads, mcp__mcp-meta-ads__create_campaign, mcp__mcp-meta-ads__create_adset, mcp__mcp-meta-ads__create_ad
---

# Skill — create-sales-cliente-exemplo-campaign (Onda 5, kind `create_sales`)

> Implementa o contrato de
> [`docs/specs/meta-ads-activation-and-sales.md`](../../../docs/specs/meta-ads-activation-and-sales.md).
> A orquestração (validação → idempotência → seleção top-N → hierarquia OUTCOME_SALES PAUSED →
> persistência → operation_logs → manifest) vive em `@template/skill-kit`:
> `orchestrateSales(args, deps)` (`packages/skill-kit/src/application/orchestrate-sales.ts`), testada
> offline com fakes. Esta SKILL.md liga as **portas** (`ports.ts`) aos adapters reais: Meta via MCP
> `mcp-meta-ads` (`listWinningCreatives` por insights + `createSales*`), catálogo/persistência via
> REST. O e2e real depende do MCP `mcp-meta-ads` e de criativos com compras (pendente).

## Garantias inegociáveis

- **Objetivo `OUTCOME_SALES`**, conversão otimizada para o evento **PURCHASE** do pixel do cliente
  (`pixel_id`), `optimization_goal=OFFSITE_CONVERSIONS`.
- **GOTCHA Meta v25: OMITIR `destination_type`.** A porta `MetaSalesAdSetSpec` **não tem** esse
  campo — ele é estruturalmente impossível de enviar. A linha `ad_sets` persistida também o omite.
- **Reuso de criativos vencedores:** `selectTopCreatives` ranqueia por compras (desc), exclui zero
  compras, e a campanha **reusa `creative_id`** (não gera criativo novo). Aborta se não houver
  vencedor (sem gasto às cegas).
- **Entidades SEMPRE nascem `PAUSED`** (gasto só depois, pela skill `activate-campaign-*`).
- **Orçamento ≤ `clients.daily_budget_cap_cents`** (clamp, não aborta; registra no manifest).
- **Idempotente:** mesma `idempotency_key`/escopo não recria campanha nem gasto.
- **`operation_logs` por mutação** (append-only). **Persistência só via REST + `SUPABASE_SECRET_KEY`**.
- **Headless-safe:** `claude -p --dangerously-skip-permissions`. **NUNCA** `AskUserQuestion`.

## Entradas (args — charset restrito)

```json
{
  "client_slug": "cliente-exemplo",
  "product_slug": "curso-exemplo",
  "daily_budget_cents": 3000,
  "budget_mode": "CBO",
  "top_n": 3,
  "window_days": 14,
  "idempotency_key": "opcional"
}
```

Slugs casam `^[a-z0-9-]+$`. Validar com `CreateSalesArgsSchema` (de `@template/skill-kit`).

## Procedimento (determinístico)

1. **Validar args** com `CreateSalesArgsSchema`. Resolver `idempotency_key`.
2. **Idempotência:** manifest `completed` com a mesma chave OU campanha de vendas ativa para o
   escopo → **não recriar**.
3. **Resolver cliente** por REST (allowlist por slug): `ad_account_id`, `pixel_id`,
   `daily_budget_cap_cents`, `currency`.
4. **Orçamento:** `resolveBudget` → clamp ao teto; `wasClamped` no manifest.
5. **Selecionar vencedores:** `listWinningCreatives` (insights read-only, janela `window_days`) →
   `selectTopCreatives(..., top_n)`. Abortar se vazio.
6. **Meta (MCP, sempre PAUSED):** criar campanha `OUTCOME_SALES` → ad set (pixel PURCHASE, **sem
   `destination_type`**) → N ads reusando os `creative_id` vencedores. Uma linha `operation_logs`
   (`action='create'`) por mutação.
7. **Persistir** por REST na ordem `campaigns → ad_sets → ads` (`build*Row` +
   `SupabaseRestClient.upsert`, sempre com `raw_spec`; ad_sets sem `destination_type`).
8. **Escrever manifest** `completed` em `tentativas-geracao-de-campanhas/<stamp>-sales.json`. Em
   qualquer aborto, manifest `failed` com `error` (sem PII/segredos).

## Erros (resumo)

- Nenhum criativo com compras → **aborta** antes de qualquer mutação; manifest `failed`.
- Orçamento acima do teto → **clampa** (não aborta).
- Cliente/pixel inexistente → aborta; manifest `failed`.
- Padrão de erro: log estruturado **sem PII** + `throw new Error("Failed to create sales campaign: …")`.

## Observabilidade

`run_id` único por execução, propagado aos `agent_events` e gravado no manifest. Logs sem PII;
segredos nunca no manifest/log/`raw_spec`.
