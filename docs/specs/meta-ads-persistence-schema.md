# SPEC — Camada de dados (schema de persistência Supabase)

- **Status:** accepted
- **Onda:** 1
- **ADRs relacionados:** [0002](../adr/0002-persistencia-supabase.md) ·
  [0003](../adr/0003-bucket-ingest-meta.md) · [0004](../adr/0004-schema-de-analise.md) ·
  [0009](../adr/0009-fila-agent-jobs.md)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §6/§10

## Objetivo

Materializar **todo** o modelo de dados da SPEC-000 §6 como migrations versionadas
(`supabase/migrations/*.sql`), fonte da verdade do banco. É a base de que todas as ondas
seguintes dependem: a fila `agent_jobs` (comunicação entre planos), a hierarquia Meta, os
criativos, a análise/funil, as landing pages, a auditoria e o espelho de tracking. Inclui RLS
deny-by-default, triggers, RPCs de claim atômico, buckets de storage e o seed do `cliente-exemplo`.

## Contratos

### Invariantes globais (SPEC-000 §6/§10/§11)

- **Dinheiro em inteiro de centavos** (`*_cents` → `bigint`/`integer`, nunca float).
- **IDs externos da Meta em `text`** (`meta_*_id`).
- **Todo upsert guarda o payload cru** em `raw_spec jsonb`.
- **RLS habilitada e deny-by-default em TODAS as tabelas**: `ENABLE ROW LEVEL SECURITY` sem
  nenhuma policy. `anon`/`authenticated` não acessam; só `service_role` (que tem `BYPASSRLS`).
- **Tabelas append-only** (`operation_logs`, `agent_events`, `lp_events`) nunca sofrem UPDATE/DELETE
  — enforçado por trigger `prevent_mutation()` (vale **inclusive para `service_role`**, já que RLS
  não barra quem tem BYPASSRLS).
- **`set_updated_at()`** dispara em toda tabela com `updated_at`.
- Toda PK é `uuid` default `gen_random_uuid()`; `created_at timestamptz default now()`.

### Tabelas por domínio

Lista de colunas-chave abaixo; o **DDL exato é a migration**. Colunas de scaffolding técnico
(`id`, `created_at`, `updated_at`, `client_id` de escopo) são adicionadas onde fazem sentido, mesmo
quando a §6 lista só as colunas-chave (a §6 diz "ver migrations para o DDL exato").

- **Conta** — `clients`: `slug` único, `ad_account_id` único, `business_manager_id`,
  `facebook_page_id`, `default_landing_url`, `daily_budget_cap_cents` ≥ 0 default `5000`,
  `currency` default `BRL`, `materials_path`.
- **Hierarquia Meta** — `campaigns` (`meta_campaign_id` único, `objective`, `budget_mode` CBO/ABO,
  `daily_budget_cents`, `status` default `PAUSED`, `special_ad_categories text[]`) →
  `ad_sets` (`meta_ad_set_id` único, `optimization_goal`, `billing_event`, `destination_type`,
  `targeting jsonb`, `advantage_audience bool`, `advantage_placements bool`) →
  `ads` (`meta_ad_id` único, `creative_id` FK, `effective_status`).
- **Criativo** — `creatives` (`meta_creative_id`, `headline`, `primary_text`, `description`,
  `call_to_action_type`, `link_url`, `image_url`, `page_id`, `generated_image_id` FK) +
  `generated_images` (`storage_bucket`+`storage_path` único, `width`/`height`, `model`, `prompt`,
  `aspect`, `cost_usd_estimate`).
- **Analytics** — `analyses` (`objective`, `window_start`/`window_stop`, `compare_window`,
  `entities_analyzed`, `overall_verdict` ∈ healthy/watch/underperforming/learning/no_data/error,
  `summary`, `triggered_by`) → `metric_snapshots` (`level` ∈ campaign/ad_set/ad, `meta_entity_id`,
  `impressions`, `spend_cents`, `ctr`, `cpc_cents`, `cpm_cents`, `landing_page_views`, `cplpv_cents`,
  `results`, `cost_per_result_cents`, `rankings jsonb`, `raw jsonb`) + `analysis_findings`
  (`severity`, `diagnosis`, `evidence jsonb`, `recommended_action`, `recommendation_type`,
  `confidence`, `is_significant`) + `funnel_events` (`level` inclui `account`, `step_order`,
  `event_type` ∈ impression/link_click/landing_page_view/view_content/add_to_cart/
  initiate_checkout/purchase, `count`, `value_cents`, `cost_per_event_cents`, `cvr_from_prev`,
  `cvr_from_top`).
- **Landing pages** — `products` (`client_id`+`slug` único, `brief_path`, `brief jsonb`,
  `default_subdomain`, `status`) → `landing_pages` (`subdomain` único, `fqdn`, `url`,
  `content_spec jsonb`, `tracking jsonb`, `theme jsonb`, `settings jsonb`, `checkout_url`,
  `price_cents`, `cart_state` open/closed, `noindex` default `true`, `ssl_status`,
  `status` draft/building/deployed/failed, `draft_status` empty/generating/ready/editing/publishing,
  `published_snapshot jsonb`, `repo_path`, `cloudflare_project_id`) + `landing_page_sections`
  (`landing_page_id`+`type` único, `position`, `enabled`, `fields jsonb`, `version`).
- **Fila & autônomo** — `agent_jobs` (`skill`, `kind` ∈ create/create_sales/activate/analyze/
  summarize/landing/landing_publish/landing_edit, `args jsonb`, `status` pending/claimed/running/
  completed/failed/cancelled, `exit_code`, `result jsonb`, `error`; **índices únicos parciais**
  garantindo ≤1 job ativo por `(client_id,kind)` e por `(landing_page_id,kind)`) +
  `autonomous_watches` (`target_kind`, `target_id`, `agent_job_id` FK, `publish_job_id` FK,
  `session_id`, `phase` watching/reviewing/notifying/done/failed, `last_event_ts`,
  `last_narrated_milestone`, `result jsonb`) + `nexus_narrations` (`watch_id` FK, `session_id`,
  `text`, `kind` status/opinion/system, `image_path`, `spoken_at`).
- **Auditoria & dashboard** — `operation_logs` (append-only; `entity_type`, `entity_id`, `action`
  create/update/delete/activate/pause, `actor`, `summary`) + `agent_events` (append-only; `run_id`,
  `agent_name`, `agent_type` skill/subagent/tool/system, `event_type` start/step/decision/error/end,
  `tool_name`, `payload jsonb`) + `daily_summaries` (`client_id`+`summary_date` único, `summary`,
  `structured jsonb`) + `lp_events` (espelho **NO-PII**; `event_id` único, `utm_*`, `country`,
  `value_cents`, `currency`, `has_email`/`has_phone` flags).

### FKs e `on delete`

- `campaigns → clients`, `ad_sets → campaigns`, `ads → ad_sets`: **CASCADE** (a hierarquia segue o pai).
- `ads → creatives`, `landing_pages → products`: **RESTRICT** (não apagar algo ainda referenciado).
- `creatives → generated_images`: **SET NULL** (imagem é opcional para o criativo).
- `agent_jobs/autonomous_watches → clients/landing_pages`: **CASCADE** no escopo do cliente.
- Tudo que tem `client_id` referencia `clients(id)` **CASCADE** (apagar cliente limpa seus dados).

### RPCs (SECURITY DEFINER)

- `claim_agent_job(worker text) → agent_jobs` — pega o `pending` mais antigo com
  `FOR UPDATE SKIP LOCKED`, marca `claimed` (+`claimed_by`,`claimed_at`), retorna a linha (ou `NULL`).
- `claim_autonomous_watch(worker text) → autonomous_watches` — pega o watch ativo mais "atrasado"
  (fase ∈ watching/reviewing/notifying) com `FOR UPDATE SKIP LOCKED`, marca `claimed_by`/`claimed_at`.
- Ambas: `security definer`, `set search_path = public`, **`EXECUTE` revogado de `public`/`anon`/
  `authenticated`** (só `service_role` chama).

### Storage buckets (ADR 0003)

`creatives` (privado), `nexus-review` (privado), `landing-assets` (público), `ad-ingest` (público —
a Meta busca a imagem do criativo aqui).

## Comportamento

- **Concorrência da fila:** múltiplos workers podem chamar `claim_agent_job` simultaneamente;
  `FOR UPDATE SKIP LOCKED` garante que cada job vai para exatamente um worker, sem bloqueio mútuo.
- **Idempotência/dedup:** os índices únicos parciais impedem dois jobs ativos do mesmo
  `(client_id,kind)` (ou `(landing_page_id,kind)`) — a 2ª inserção falha com unique violation, que o
  produtor trata como "já enfileirado".
- **Append-only:** UPDATE/DELETE em `operation_logs`/`agent_events`/`lp_events` levanta exceção.
- **Erros:** migrations idempotentes onde possível (`create ... if not exists` em buckets/extensões);
  o DDL de tabelas roda uma vez via `supabase db reset`.

## Segurança

- **RLS deny-by-default** em todas as tabelas (sem policies). Leituras do dashboard são server-side
  via `service_role`; o browser nunca lê tabela direto.
- **RPCs de claim** com `EXECUTE` revogado de anon/authenticated → só o runner (service_role).
- **Sem PII** em `lp_events` (só flags + utm + country + valor).
- **Segredos** (`DATABASE_URL`, `SUPABASE_SECRET_KEY`) fora do código (`.env.local`/`fly secrets`).
- Threat model do banco como superfície: [`docs/security/threats/supabase-data-layer.md`](../security/threats/supabase-data-layer.md).

## Critérios de aceite (gate da Onda 1)

1. `supabase db reset` aplica todas as migrations + seed **limpo** (sem erro).
2. `select` em cada tabela como `service_role` funciona; como `anon` **falha** (RLS).
3. `claim_agent_job` claima atômico (job vira `claimed`, `claimed_by` setado).
4. Índice único parcial barra 2º job ativo do mesmo `(client_id,kind)`.
5. UPDATE em tabela append-only é rejeitado.
6. Seed do `cliente-exemplo` presente em `clients`.
7. `npm run lint && npm run typecheck && npm test` seguem verdes.

## Testes

- **Integração (psql/SQL):** RLS service_role vs anon; claim atômico; unique parcial; append-only
  trigger; presença do seed. Roteiro em `scripts/verify-wave1.sql` (executado no gate).
- **Unit:** N/A nesta onda (SQL puro; lógica de domínio entra a partir da Onda 2).
