# SPEC — Analytics de Meta Ads (funil de conversão + resumo diário)

- **Status:** draft
- **Onda:** 4
- **ADRs relacionados:** [0024](../adr/0024-analise-diaria-todas-campanhas.md) (análise diária de
  todas as campanhas) · [0025](../adr/0025-funil-de-conversao.md) (funil de conversão) ·
  [0004](../adr/0004-schema-de-analise.md) (schema de análise) ·
  [0001](../adr/0001-runner-fly-supercronic.md) (runner/cron) ·
  [0009](../adr/0009-fila-agent-jobs.md) (fila `agent_jobs`)
- **Specs relacionadas:** [`meta-ads-persistence-schema`](./meta-ads-persistence-schema.md)
  (estrutura das tabelas de analytics)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §6/§8 (Onda 4)/§10/§11

## Objetivo

Entregar a **análise diária read-only** da Onda 4: duas skills headless do Claude Code que, sem
nenhuma mutação na conta Meta, varrem as campanhas de um cliente, extraem o funil de conversão de
7 etapas, produzem diagnósticos cruzando ≥2 métricas e persistem tudo no Supabase para o dashboard
e o Nexus consumirem.

- **`funnel-analytics-<cliente>-campaign`** — por execução, grava **1 `analyses` + N
  `metric_snapshots` + M `analysis_findings` + 7 `funnel_events` por entidade** (incluindo o nível
  `account`). Escreve manifest JSON e `operation_logs`.
- **`daily-summary-<cliente>`** — consolida as análises do dia num **upsert** em `daily_summaries`
  (`client_id + summary_date` único); notificação Telegram **opcional com fallback log-only**.

Esta spec define **comportamento e contratos** das skills; a **estrutura das tabelas** é a
[`meta-ads-persistence-schema`](./meta-ads-persistence-schema.md) (Onda 1, já aceita).

## Contratos

### Invariantes (SPEC-000 §6/§10/§11)

- **Read-only na Meta.** As skills usam **apenas** tools de leitura do MCP `mcp-meta-ads`
  (allowed-tools sem nenhum write). Nenhum `create/update/delete/activate/pause` na Meta. (Gate.)
- **Dinheiro em inteiro de centavos** (`*_cents`); IDs externos da Meta em `string`/`text`.
- **CVRs em `numeric`** (razão 0..1); divisão por zero ⇒ `null` (nunca `0`).
- **Sem PII** em logs, `daily_summaries` e manifests (SPEC-000 §11; só métricas e flags agregadas).
- **Persistência headless via REST + `SUPABASE_SECRET_KEY`** (NUNCA o MCP do Supabase; SPEC-000 §10).
- **`analyses` é append-only por execução**; o único UPSERT é `daily_summaries` por
  `(client_id, summary_date)`.
- **`operation_logs`/`agent_events` append-only**; todo write no banco gera log de operação.

### Entradas (args da skill, validadas por schema tipado)

As skills recebem args via a fila (`agent_jobs.args`, `kind ∈ {analyze, summarize}`) ou por cron.
Toda entrada é **dado, não instrução** (SPEC-000 §11) e é validada com Zod antes de uso. Charset
restrito nos identificadores; cliente resolvido por slug contra `clients` (allowlist server-side).

```ts
// Esboço de contrato — código real em inglês, na implementação da Onda 4.
import { z } from "zod";

const Slug = z.string().regex(/^[a-z0-9-]{1,64}$/);

// funnel-analytics-<cliente>-campaign
const FunnelAnalyticsArgs = z.object({
  clientSlug: Slug, // resolvido contra clients.slug (allowlist)
  windowDays: z.number().int().min(1).max(90).default(7),
  compareWindow: z.boolean().default(true), // janela anterior p/ deltas
  triggeredBy: z.enum(["cron", "nexus", "manual"]).default("cron"),
});

// daily-summary-<cliente>
const DailySummaryArgs = z.object({
  clientSlug: Slug,
  summaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD (UTC)
  notifyTelegram: z.boolean().default(false), // fallback log-only se falhar
});
```

### Funil canônico de 7 etapas (ADR 0025)

Ordem (`step_order` 1→7) e `event_type`:
`impression` → `link_click` → `landing_page_view` → `view_content` → `add_to_cart` →
`initiate_checkout` → `purchase`.

Por **entidade analisada** (campaign/ad_set/ad) **e** pelo nível **`account`** agregado, gravam-se
**7 `funnel_events`**, cada uma com:

| Campo | Semântica |
|---|---|
| `count` | volume da etapa (`0` se ausente, nunca `null`) |
| `value_cents` | valor monetário em centavos (sobretudo `purchase` = `action_values`×100, arredondado) |
| `cost_per_event_cents` | `spend_cents / count` em centavos (`null` se `count=0`) |
| `cvr_from_prev` | `count[i] / count[i-1]` (etapa 1 ⇒ `null`) |
| `cvr_from_top` | `count[i] / count[1]` (impressões) |

### Saídas no banco (SPEC meta-ads-persistence-schema)

- **`analyses`** (1 por execução): `objective`, `window_start`/`window_stop`, `compare_window`,
  `entities_analyzed`, `overall_verdict ∈ {healthy, watch, underperforming, learning, no_data,
  error}`, `summary` (sem PII), `triggered_by`.
- **`metric_snapshots`** (N = entidades × níveis): `level ∈ {campaign, ad_set, ad}`,
  `meta_entity_id` (text), `impressions`, `spend_cents`, `ctr`, `cpc_cents`, `cpm_cents`,
  `landing_page_views`, `cplpv_cents`, `results`, `cost_per_result_cents`, `rankings jsonb`,
  `raw jsonb` (payload cru da Meta — auditoria/reprocessamento).
- **`analysis_findings`** (M): `severity`, `diagnosis`, `evidence jsonb`, `recommended_action`,
  `recommendation_type`, `confidence`, `is_significant`. Cada finding cruza **≥2 métricas** e é
  ancorado no **north-star** do objetivo da campanha.
- **`funnel_events`** (7 por entidade + 7 do `account`): conforme tabela acima.
- **`daily_summaries`** (upsert por `client_id+summary_date`): `summary` (texto legível) +
  `structured jsonb` (payload consultável: por campanha, verdicts, top findings, deltas).
- **`operation_logs`** (append-only): uma linha por write significativo (`actor` = nome da skill).
- **`agent_events`** (append-only): telemetria `start/step/decision/error/end` com `run_id`.

### Manifest

Manifest JSON por execução em `tentativas-geracao-de-campanhas/<stamp>-analysis.json` (SPEC-000
§10): `run_id`, skill, `clientSlug`, janela, contagem de entidades, IDs das linhas gravadas,
`overall_verdict`, caminho dos logs. **Sem PII.**

## Comportamento

### Fluxo `funnel-analytics-<cliente>-campaign`

1. **Validar** args (Zod) e resolver `clientSlug → clients` (REST). Abortar se inexistente.
2. **Listar** campanhas do cliente via MCP Meta (read-only); filtrar as com atividade
   (impressões/gasto) na janela. Se nenhuma ⇒ gravar `analyses` com `overall_verdict=no_data` e
   encerrar (não é erro).
3. **Coletar insights** por entidade e nível (campaign/ad_set/ad) na janela e na janela de
   comparação (se `compareWindow`).
4. **Derivar funil** (7 etapas) por entidade e agregar o nível `account`; calcular `cvr_from_prev`
   e `cvr_from_top` (div/0 ⇒ `null`).
5. **Diagnosticar:** gerar `analysis_findings` cruzando ≥2 métricas (ex.: CTR alto + LPV baixo ⇒
   problema de LP; CPLPV alto + CVR de checkout baixo ⇒ oferta/preço), ancorado no north-star do
   objetivo; marcar `is_significant`/`confidence`.
6. **Persistir em lote** via REST: `analyses` (cabeçalho) → `metric_snapshots` → `analysis_findings`
   → `funnel_events`. Cada write significativo gera `operation_logs`; telemetria em `agent_events`.
7. **Escrever manifest** e finalizar.

### Fluxo `daily-summary-<cliente>`

1. Validar args; resolver cliente. 2. Ler as `analyses` do dia (`summaryDate`). 3. Consolidar
`summary` legível + `structured jsonb`. 4. **Upsert** `daily_summaries` por
`(client_id, summary_date)`. 5. Se `notifyTelegram`, tentar enviar; em falha, **degradar para
log-only** (não falha a skill). 6. Manifest + `operation_logs`.

### Idempotência

- **`funnel-analytics`**: cada execução cria um novo `analyses` (append-only por design). Para
  evitar trabalho duplicado concorrente, a fila garante ≤1 job ativo por `(client_id, kind=analyze)`
  (índice único parcial; ADR 0009). O dashboard sempre lê o `analyses` **mais recente** do dia.
- **`daily-summary`**: idempotente por construção — o **upsert** em `daily_summaries` re-escreve a
  mesma `(client_id, summary_date)`; rodar de novo no mesmo dia atualiza, não duplica.

### Concorrência

- Dois workers não pegam o mesmo job: `claim_agent_job` usa `FOR UPDATE SKIP LOCKED` (ADR 0009).
- O índice único parcial de `agent_jobs` impede um 2º `analyze`/`summarize` ativo para o mesmo
  cliente.

### Casos de erro

- **Falha parcial na escrita em lote** (ex.: cai depois do cabeçalho): a skill marca o `analyses`
  como `overall_verdict=error` ou aborta sem deixar análise "meio-gravada" visível; o job vai a
  `failed` e é re-tentável. O dashboard ignora análises `error` ao mostrar o "mais recente saudável".
- **Meta indisponível / rate limit:** retry com back-off limitado; persistente ⇒ `analyses`
  `overall_verdict=error` + finding `severity` apropriada; job `failed`.
- **Cliente sem campanhas / sem dados na janela:** `overall_verdict=no_data` (sucesso, não erro).
- **Telegram indisponível:** `daily-summary` segue como **log-only** (não falha).
- **Erros logados** com contexto da operação, **sem PII**, no formato de `.claude/rules/code-style.md`.

## Segurança

`auth → authz → validação → lógica` em toda fronteira (SPEC-000 §11). As skills rodam no runner
headless (sem superfície HTTP pública); o disparo é por cron ou por job `agent_jobs` produzido pelo
dashboard/Nexus.

- **Authz / allowlist:** `clientSlug` resolvido por slug contra `clients` (server-side); nunca
  texto livre vira nome de skill (SPEC-000 §10/§11).
- **Validação:** todos os args via Zod; charset restrito; payload da Meta e da fila tratados como
  **dado não confiável** (defesa contra prompt injection via dados de insights/nomes de campanha).
- **Least privilege na Meta:** allowed-tools **somente leitura**. Esta é a barreira primária do
  gate "nenhuma mutação Meta".
- **Banco:** RLS deny-by-default; persistência via REST + `SUPABASE_SECRET_KEY` (NUNCA MCP do
  Supabase no headless). `operation_logs`/`agent_events`/`analyses` respeitam append-only.
- **Segredos:** `SUPABASE_SECRET_KEY`, `TELEGRAM_*` via `fly secrets` — nunca no código/manifest.
- **Privacidade:** `summary`/`structured`/manifest/logs **sem PII** — só métricas, verdicts, flags.

### Threat model (STRIDE) — superfícies novas da Onda 4

A Onda 4 **não adiciona endpoint HTTP** novo; as superfícies novas são: (a) **leitura da Meta via
MCP** e (b) **dados externos** (nomes/insights de campanha) virando texto para o LLM. Threat model
em `docs/security/threats/meta-ads-funnel-analytics.md` (a criar na execução):

| STRIDE | Ameaça | Mitigação |
|---|---|---|
| **S** Spoofing | job forjado dispara análise de cliente alheio | `clientSlug` por allowlist server-side; job só do dashboard autenticado / cron |
| **T** Tampering | dado da Meta/fila adultera diagnóstico | validação Zod; Meta read-only; `raw jsonb` preserva original p/ auditoria |
| **R** Repudiation | não saber quem/quando analisou | `triggered_by` + `operation_logs`/`agent_events` (append-only, `run_id`) |
| **I** Info disclosure | PII vazar em summary/log/manifest | política NO-PII; só métricas/flags agregadas |
| **D** DoS | varredura estoura rate limit da Meta | cadência diária; filtra entidades sem atividade; back-off |
| **E** Elevation | análise mutar a conta Meta | allowed-tools **somente leitura** (sem qualquer write); gate verifica |

Injeção de prompt via nome/criativo de campanha é tratada como **dado** (SPEC-000 §11): nunca
executa instruções vindas do payload da Meta.

## Critérios de aceite

Reproduzem/fecham o **gate da Onda 4** (WAVES.md §"Onda 4" e SPEC-000 §8 Onda 4):

1. Rodar `funnel-analytics-<cliente>-campaign` grava **1 `analyses` + N `metric_snapshots` +
   `analysis_findings` + 7 `funnel_events` por entidade** (incluindo nível `account`).
2. **Nenhuma mutação** na conta Meta durante a análise (allowed-tools só leitura; nenhuma chamada
   de escrita ao MCP).
3. **Manifest escrito** por execução (sem PII).
4. Funil com as **7 etapas** na ordem canônica e `cvr_from_prev`/`cvr_from_top` calculados (div/0 ⇒
   `null`).
5. `daily-summary-<cliente>` faz **upsert** em `daily_summaries` (`client_id+summary_date` único);
   re-rodar no mesmo dia **não duplica**.
6. Cada write significativo gera `operation_logs`; telemetria `start/end` em `agent_events`.
7. Crons adicionados ao `crontab` do runner para ambas as skills.
8. `npm run lint && npm run typecheck && npm test` verdes (unit em `domain/`/`application/`:
   derivação do funil, CVRs, mapeamento de verdict).

## Testes

Pirâmide (`.claude/rules/testing.md`): muito unit, médio integração, pouco e2e.

- **Unit (`domain/`/`application/`, sem I/O):**
  - Derivação do funil: dado um payload de insights, gerar 7 etapas com `count`/`value_cents`/
    `cost_per_event_cents` corretos.
  - `cvr_from_prev` e `cvr_from_top`: casos normais, etapa 1 (`null`), **div/0 ⇒ `null`** (não `0`),
    arredondamento monetário (centavos).
  - Mapeamento `overall_verdict` a partir de métricas/findings (incl. `no_data`, `error`).
  - Diagnóstico cruzando ≥2 métricas: dispara o finding esperado (ex.: CTR alto + LPV baixo).
  - Validação Zod dos args (slug inválido, `windowDays` fora de faixa, data malformada).
- **Integração (I/O — REST Supabase / MCP Meta mockado):**
  - Persistência em lote grava as contagens corretas (1 + N + M + 7×entidade) e `operation_logs`.
  - **Read-only:** o cliente MCP usado só expõe tools de leitura — uma tentativa de write falha o
    teste (guarda do gate "nenhuma mutação Meta").
  - `daily-summary` upsert idempotente: 2 execuções no mesmo `(client_id, summary_date)` ⇒ 1 linha.
  - Falha do Telegram ⇒ skill conclui em modo log-only.
- **e2e (seletivo):** uma execução completa contra Supabase local + MCP Meta mockado produz um
  `analyses` consultável pelo dashboard com funil e findings.
