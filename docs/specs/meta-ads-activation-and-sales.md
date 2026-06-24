# SPEC — Ativação de campanha + campanha de vendas (Meta Ads)

- **Status:** draft
- **Onda:** 5
- **ADRs relacionados:** [0007](../adr/0007-revalidacao-fail-closed-ativacao.md) (revalidação
  fail-closed na ativação) · [0008](../adr/0008-reuso-criativos-vencedores-vendas.md) (reuso de
  criativos vencedores em vendas) · [0002](../adr/0002-persistencia-supabase.md) (persistência) ·
  [0009](../adr/0009-fila-agent-jobs.md) (fila `agent_jobs`)
- **Specs relacionadas:** [`create-traffic-campaign`](./create-traffic-campaign.md) (molde de skill
  de criação + portas + invariantes Meta) · [`meta-ads-funnel-analytics`](./meta-ads-funnel-analytics.md)
  (fonte das compras por criativo) · [`meta-ads-persistence-schema`](./meta-ads-persistence-schema.md)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 (Onda 5)/§10/§11

## Objetivo

Entregar a Onda 5: duas skills headless do Claude Code que fecham o ciclo operacional.

- **`activate-campaign-cliente-exemplo`** (kind `activate`) — coloca no ar (gasto real) uma entidade
  Meta que **já passou** nas validações, **revalidando na hora** e **abortando na dúvida**
  (fail-closed). É a **única** skill do sistema que inicia gasto.
- **`create-sales-cliente-exemplo-campaign`** (kind `create_sales`) — cria uma campanha
  **`OUTCOME_SALES`** otimizada para o evento **PURCHASE** do pixel, **reusando os top-N criativos
  vencedores por compras**. Entidades nascem **PAUSED**; **omite `destination_type`** (Meta v25).

A lógica pura (guards, seleção, orquestração) vive em `@template/skill-kit`
(`orchestrateActivation`, `orchestrateSales`, `assertActivationSafe`, `selectTopCreatives`), testada
offline com fakes. As SKILL.md ligam as portas aos adapters reais (Meta via MCP `mcp-meta-ads`;
persistência via REST + `SUPABASE_SECRET_KEY`).

## Contratos

### Skill `activate-campaign` (kind `activate`)

- **Args (`ActivateArgsSchema`):** `client_slug` (`^[a-z0-9-]+$`), `meta_entity_id`
  (`^[A-Za-z0-9_:-]+$` — id externo da Meta é `text`), `entity_type` ∈ `campaign|ad_set|ad`
  (default `campaign`), `idempotency_key?`.
- **Porta Meta (`MetaActivationPort`) — superfície mínima:** `getEntity(id)` (leitura) +
  `activateEntity(id)` (a **única** mutação). Sem pause/delete/mudança de orçamento expostos.
- **Revalidação (`assertActivationSafe`)** — exige TODAS: (1) entidade lida == `meta_entity_id`
  pedida; (2) `ad_account_id` == o do cliente; (3) status atual **PAUSED**; (4)
  `daily_budget_cents` ≤ `clients.daily_budget_cap_cents`. Qualquer falha → **abortar**.
- **Persiste:** 1 `operation_logs` (`action='activate'`, append-only) por ativação. Manifest
  `<stamp>-activate.json`.

### Skill `create_sales` (kind `create_sales`)

- **Args (`CreateSalesArgsSchema`):** `client_slug`, `product_slug`, `daily_budget_cents?` (clamp ao
  teto), `budget_mode` ∈ `CBO|ABO` (default `CBO`), `top_n` 1..10 (default 3), `window_days` 1..90
  (default 14), `idempotency_key?`.
- **Seleção (`selectTopCreatives`)** — ranqueia candidatos por `purchases` (desc), desempata por
  `purchase_value_cents` e por id (determinístico), **exclui zero compras**, corta em `top_n`.
  Vazio → abortar (sem gasto às cegas).
- **Hierarquia Meta (`MetaSalesPort`)** — `createSalesCampaign` (`OUTCOME_SALES`, **PAUSED**) →
  `createSalesAdSet` (pixel `pixel_id`, `custom_event_type='PURCHASE'`,
  `optimization_goal='OFFSITE_CONVERSIONS'`, **sem `destination_type`** — campo ausente da
  interface) → `createSalesAd` por criativo reusado (`meta_creative_id`).
- **Persiste:** `campaigns → ad_sets → ads` por REST (cada linha com `raw_spec`; `ad_sets` sem
  `destination_type`); 1 `operation_logs` por mutação. Manifest `<stamp>-sales.json`.

### Invariantes (valem para as duas)

- Dinheiro em **inteiro de centavos**; ids externos da Meta em `text`.
- Entidades de vendas **nascem PAUSED** (gasto só pela ativação, em passo separado).
- `operation_logs`/`agent_events` **append-only**, sem PII/segredos.
- Meta **só** via MCP `mcp-meta-ads`; Supabase **só** via REST + `SUPABASE_SECRET_KEY` (nunca MCP).

## Comportamento

- **Ativação (fail-closed):** validar args → resolver cliente (allowlist por slug) → **re-ler a
  entidade na Meta** → se já `ACTIVE`, `skipped` (idempotente, sem segundo flip) → revalidar
  (`assertActivationSafe`) → ligar (`activateEntity`) → **verificar** o novo status efetivo (se não
  virou `ACTIVE`, abortar) → `operation_logs` → manifest `completed`. Qualquer aborto escreve
  manifest `failed` e **não liga nada**.
- **Vendas:** validar args → idempotência (manifest `completed` ou campanha de vendas ativa →
  `skipped`/recusa) → resolver cliente (+`pixel_id`) → clamp de orçamento → selecionar top-N →
  criar hierarquia PAUSED reusando criativos → persistir → manifest. Aborto → manifest `failed`,
  nenhuma mutação parcial de campanha (a campanha só é criada após a seleção ter vencedores).
- **Idempotência:** ativação por estado atual (`ACTIVE` = no-op); vendas por `idempotency_key`
  (derivada de `client/product/dia-UTC`) + probe de campanha ativa. Re-run não duplica gasto.
- **Concorrência:** a fila `agent_jobs` garante ≤1 job ativo por `(client_id, kind)` (índice único
  parcial, Onda 1); a skill é idempotente como segunda linha de defesa.

## Segurança

- **Ordem `auth → authz → validação → lógica`.** Args validados por Zod (charset restrito) **antes**
  de qualquer uso; `meta_entity_id` é dado, nunca instrução/caminho.
- **Fail-closed na ativação** é o controle central de Onda 5: o único caminho que inicia gasto exige
  revalidação completa e **não tem modo força**. Mitiga STRIDE *Tampering*/*Elevation* (ativar a
  entidade errada, de outro cliente, fora do teto).
- **Least privilege na porta Meta de ativação:** só `getEntity` + `activateEntity`. Vendas não cria
  criativo novo (reusa ids), reduzindo superfície.
- **RLS deny-by-default** (só `service_role`); persistência server-side via REST. **Segredos fora do
  código** (`.env.local`/`fly secrets`). **Sem PII** em logs/manifests/`raw_spec`.
- **Threat model:** a superfície externa nova (ligar gasto real) é coberta pelo ADR 0007; o threat
  model STRIDE consolidado fica para a Onda 11 (hardening), referenciando esta spec.

## Critérios de aceite

1. Ativação só liga o que passou em **todas** as validações (`assertActivationSafe`) e grava
   `operation_logs` com `action='activate'`; entidade não-PAUSED / conta errada / acima do teto /
   id divergente → **aborta** sem flip.
2. Entidade já `ACTIVE` → `skipped` idempotente (sem segundo flip nem novo log).
3. Vendas cria entidades **PAUSED** com `objective='OUTCOME_SALES'`, **omitindo `destination_type`**,
   reusando os top-N `creative_id` por compras; sem vencedor → aborta.
4. Gate offline verde: `npm run typecheck && npm run lint && npm test` (com mocks/portas). O e2e real
   com Meta fica adiado por credenciais.

## Testes

- **Unit (domain):** `assertActivationSafe` (happy + aborta em cada divergência); `selectTopCreatives`
  (top-N, exclui zero compras, desempate determinístico, sem mutação do input, `topN` inválido).
- **Unit (application):** `orchestrateActivation` (ativa+loga; aborta em não-PAUSED/over-cap/conta
  errada/flip não confirmado/args inválidos; skip de já-`ACTIVE`); `orchestrateSales` (cria PAUSED
  OUTCOME_SALES; omite `destination_type`; 1 log/mutação; clamp de orçamento; aborta sem vencedor;
  manifest `failed` em args inválidos; idempotência por manifest e por campanha ativa).
- **Integração/e2e (adiado por credenciais):** adapters reais do MCP `mcp-meta-ads`
  (`get_*`/`update_*`/`create_*`) + persistência REST; ligar uma campanha PAUSED de teste e criar
  uma campanha de vendas reusando criativos reais com compras.
