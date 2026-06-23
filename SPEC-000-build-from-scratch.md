# SPEC-000 — Construir o projeto do zero com o Claude Code

> **O que é este documento.** Um spec-driven build plan: a "planta" completa para
> (re)construir esta agência de tráfego Meta Ads operada por IAs. Quem tiver este doc + o
> Claude Code + as credenciais (no `.env.local`) consegue erguer o sistema inteiro, onda a
> onda. Cada onda tem **objetivo → entregáveis → contratos/modelo de dados → critérios de
> aceite → prompt sugerido** para colar no Claude Code.
>
> **Como usar.** Trabalhe **uma onda por vez**, em ordem. Antes de cada onda, escreva/atualize
> a spec da feature (`docs/specs/<feature>.md`) e o ADR quando houver decisão estrutural
> (`docs/adr/`). Só avance quando os critérios de aceite da onda passarem. Convenções de
> qualidade (typing estrito, validação em fronteiras, RLS, logs sem PII, testes) valem em
> todas as ondas — ver §11.
>
> **Placeholders do template** (troque pelos seus): cliente `cliente-exemplo`, produtos
> `curso-exemplo`/`workshop-exemplo`, assistente **Nexus**, agência **Acme**, domínio
> **example.com**, npm scope **@template**, app Fly **meta-ads-agents**.

---

## 1. Visão & escopo

**Missão:** uma agência de tráfego Meta Ads (Facebook/Instagram Ads) **100% operada por IAs**,
24/7, que cria campanhas, analisa performance (funil completo), gera e publica landing pages,
e é supervisionada por um operador humano através de um dashboard com assistente de voz
(**Nexus**).

**Três planos de execução (decoplados, comunicação só via banco):**
1. **Dashboard (Vercel / Next.js)** — onde o operador vê tudo e fala com o Nexus. Só
   request/response. Enfileira trabalho em `agent_jobs`.
2. **Runner headless (Fly.io machine)** — cron + fila. Executa as *skills* do Claude Code em
   modo `claude -p --dangerously-skip-permissions`. Sem superfície HTTP pública.
3. **Banco (Supabase Postgres)** — única fonte da verdade e único canal entre os planos.
   Mais Cloudflare (Pages para landing pages + Worker de tracking).

**Princípio-chave:** nenhum webhook nem chamada inbound entre planos. Dashboard escreve um
job; runner faz polling, executa, escreve o resultado; dashboard lê o resultado. Idempotência
e locks garantem segurança sob concorrência.

---

## 2. Pré-requisitos — contas & credenciais (o builder providencia)

Crie estas contas e gere os segredos. Todos vão para `.env.local` (dev) e `fly secrets`
(prod). O `.env.example` no repo é a lista canônica — copie para `.env.local` e preencha.

| Serviço | Para quê | Chaves |
|---|---|---|
| **Anthropic** (Claude) | LLM de decisão + Claude Code CLI | `CLAUDE_API_KEY` (e OAuth do CLI no runner) |
| **OpenAI** | Geração de imagem (gpt-image-2) + STT (Whisper) | `OPENAI_API_KEY` |
| **Supabase** | Postgres + Storage + Auth | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` |
| **Upstash Redis** | cache + rate limit + idempotência | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Upstash QStash** | scheduler dinâmico (opcional) | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` |
| **Cloudflare** | Pages (landing pages) + Worker (tracking) + DNS | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` |
| **ElevenLabs** | TTS (voz do Nexus) | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| **Picovoice** | wake word ("Nexus") | `PICOVOICE_ACCESS_KEY`, `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` |
| **Resend** | email do modo autônomo (opcional) | `RESEND_API_KEY`, `AUTONOMOUS_NOTIFY_EMAIL`, `AUTONOMOUS_FROM_EMAIL` |
| **Telegram** (opcional) | notificação das análises | `TELEGRAM_CHAT_ID` |
| **Meta Marketing API** | criar/ler campanhas | conectada via **MCP `mcp-meta-ads`** (connector da Anthropic), não por env |
| **Fly.io** | hospedar o runner | conta + `flyctl` |
| **Vercel** | hospedar o dashboard | conta + projeto |

Segredos do dashboard: `DASHBOARD_PASSWORD` (hash SHA-256 da senha), `AUTH_SECRET` (≥32
bytes aleatórios). Ver `.env.example` para a lista completa e comentários.

> **Autenticação Meta:** feita na vinculação do MCP da Meta no Claude Code (não há token Meta
> em env). As skills sempre falam com a Meta **apenas via o MCP**.

---

## 3. Arquitetura (visão de alto nível)

```
┌────────────────────────┐        ┌──────────────────────────┐
│  Dashboard (Vercel)     │        │  Runner headless (Fly.io) │
│  Next.js 15 + Nexus     │        │  supercronic + claude -p  │
│  - lê métricas/estado   │        │  - cron: cria/analisa/    │
│  - voz (STT/TTS/VAD)    │        │    resume                 │
│  - enfileira agent_jobs │        │  - poll agent_jobs        │
└───────────┬────────────┘        │  - poll autonomous_watches│
            │ escreve/lê          └────────────┬─────────────┘
            ▼                                   │ claim + executa skill
     ┌───────────────────────────────────────────────────┐
     │            Supabase Postgres (RLS, service_role)    │  ← única fonte da verdade
     │  clients, campaigns, ad_sets, ads, creatives,       │
     │  analyses, metric_snapshots, analysis_findings,     │
     │  funnel_events, agent_jobs, agent_events,           │
     │  operation_logs, daily_summaries, landing_pages,    │
     │  landing_page_sections, products, autonomous_watches│
     │  nexus_narrations, lp_events  + Storage buckets      │
     └───────────────────────────────────────────────────┘
            ▲                         ▲
            │ MCP (read/write)        │ Pages deploy / Worker events
   ┌────────┴─────────┐      ┌────────┴───────────────────────┐
   │ Meta Marketing   │      │ Cloudflare: Pages (<lp>.domain)│
   │ API (mcp-meta-ads)│     │ + Worker de tracking (track.*) │
   └──────────────────┘      └────────────────────────────────┘
```

**Decisões âncora** (já existem como ADRs; reproduza-as ao construir):
fila por polling sem broker (ADR 0009), runner em Fly com supercronic (ADR 0001), persistência
Supabase (ADR 0002/0004), landing pages estáticas no Cloudflare Pages (ADR 0012), ContentDoc
editável no Supabase (ADR 0015), pacote compartilhado `@template/lp-render` (ADR 0017),
funil de conversão (ADR 0025), modo autônomo do Nexus (ADR 0019), tracking server-side (ADR 0021).

---

## 4. Stack

- **Backend:** TypeScript 5.6 + Node 22 + Next.js 15 (App Router) + Hono nos route handlers.
- **Frontend:** Next.js 15 + React 19 + Tailwind 4 + shadcn/ui.
- **DB:** Supabase Postgres 16 (RLS deny-by-default) + migrations versionadas.
- **Cache/locks:** Upstash Redis. **Fila:** tabela `agent_jobs` (polling). **Scheduler:** supercronic (cron) + Vercel Cron + QStash (opcional).
- **AI:** Anthropic SDK (decisão/voz) + Claude Code CLI (skills headless) + OpenAI gpt-image-2 (imagem) / Whisper (STT) + ElevenLabs (TTS).
- **MCP:** `mcp-meta-ads` (Meta Marketing API) e Supabase MCP (no contexto interativo).
- **Infra:** Vercel (dashboard, region gru1) + Supabase (sa-east-1) + Fly.io machine (gru) + Cloudflare (Pages/Worker/DNS). IaC: Supabase CLI + `vercel.json` + `fly.toml` + `Dockerfile`.

---

## 5. Layout do repositório (monorepo modular)

```
.
├── .claude/
│   ├── skills/                 # skills do Claude Code (uma pasta por skill)
│   ├── agents/                 # subagents (copywriter, scrape-extractor, image-prompt-generator, ...)
│   ├── hooks/                  # emit-agent-event.py, remind-update-project-memory.py
│   └── materiais-das-empresas/<cliente>/   # logo, fotos, refs, produtos/<slug>.json
├── web/                        # dashboard Next.js (Vercel) + Nexus
├── packages/lp-render/         # pacote compartilhado de render de landing page (@template/lp-render)
├── landing-pages/_template/    # template Next.js (static export) clonado por LP
├── worker/track/               # Cloudflare Worker de tracking server-side
├── scripts/                    # runner: poll-agent-jobs.sh, run-skill.sh, emit-from-stream.py, ...
├── supabase/migrations/        # schema (fonte da verdade do DB)
├── docs/{adr,specs,how-to,reference,tutorials,explanation,security/threats,templates}/
├── Dockerfile, fly.toml, crontab   # runner Fly.io
├── vercel.json                 # crons declarativos + config Vercel
└── .env.example                # contrato de variáveis de ambiente
```

Dependências apontam pra dentro: `presentation → application → domain`; `infrastructure`
implementa interfaces do domínio. Boundaries entre bounded contexts via interface pública.

---

## 6. Modelo de dados (contrato do banco — Onda 1)

Postgres com **RLS habilitado e deny-by-default em todas as tabelas** (sem policies; só o
`service_role` acessa). Dinheiro sempre em **inteiro de centavos**. IDs externos da Meta em
`text`. Todo upsert guarda o payload cru em `raw_spec jsonb`. Trigger `set_updated_at()` em
toda tabela com `updated_at`. Tabelas append-only (logs/eventos) nunca sofrem UPDATE.

**Tabelas por domínio** (colunas-chave; ver migrations para o DDL exato):

- **Conta:** `clients` (slug único, ad_account_id único, business_manager_id, facebook_page_id, default_landing_url, daily_budget_cap_cents≥0 default 5000, currency, materials_path).
- **Hierarquia Meta:** `campaigns` (meta_campaign_id único, objective, budget_mode CBO/ABO, daily_budget_cents, status default PAUSED, special_ad_categories[]) → `ad_sets` (meta_ad_set_id, optimization_goal, billing_event, destination_type, targeting jsonb, advantage_audience/placements) → `ads` (meta_ad_id, creative_id FK, effective_status).
- **Criativo:** `creatives` (meta_creative_id, headline, primary_text, description, call_to_action_type, link_url, image_url, page_id, generated_image_id FK) + `generated_images` (storage_bucket+storage_path único, width/height, model, prompt, aspect, cost_usd_estimate).
- **Analytics:** `analyses` (objective, window_start/stop, compare_window, entities_analyzed, overall_verdict ∈ healthy/watch/underperforming/learning/no_data/error, summary, triggered_by) → `metric_snapshots` (level ∈ campaign/ad_set/ad, meta_entity_id, impressions, spend_cents, ctr, cpc_cents, cpm_cents, landing_page_views, cplpv_cents, results, cost_per_result_cents, rankings, raw) + `analysis_findings` (severity, diagnosis, evidence jsonb, recommended_action, recommendation_type, confidence, is_significant) + `funnel_events` (level inclui `account`, step_order, event_type ∈ impression/link_click/landing_page_view/view_content/add_to_cart/initiate_checkout/purchase, count, value_cents, cost_per_event_cents, cvr_from_prev, cvr_from_top).
- **Landing pages:** `products` (client_id+slug único, brief_path, brief jsonb, default_subdomain, status) → `landing_pages` (subdomain único, fqdn, url, content_spec jsonb, tracking jsonb, theme jsonb, settings jsonb, checkout_url, price_cents, cart_state open/closed, noindex default true, ssl_status, status draft/building/deployed/failed, draft_status empty/generating/ready/editing/publishing, published_snapshot jsonb, repo_path, cloudflare_project_id) + `landing_page_sections` (landing_page_id+type único, position, enabled, fields jsonb, version).
- **Fila & autônomo:** `agent_jobs` (skill, kind ∈ create/create_sales/activate/analyze/summarize/landing/landing_publish/landing_edit, args jsonb, status pending/claimed/running/completed/failed/cancelled, exit_code, result jsonb, error; **índices únicos parciais** garantindo ≤1 job ativo por (client_id,kind) e por (landing_page_id,kind)) + `autonomous_watches` (target_kind, target_id, agent_job_id FK, publish_job_id FK, session_id, phase watching/reviewing/notifying/done/failed, cursors last_event_ts/last_narrated_milestone, result jsonb) + `nexus_narrations` (watch_id FK, session_id, text, kind status/opinion/system, image_path, spoken_at).
- **Auditoria & dashboard:** `operation_logs` (append-only; entity_type, action create/update/delete/activate/pause, actor, summary) + `agent_events` (append-only; run_id, agent_name, agent_type skill/subagent/tool/system, event_type start/step/decision/error/end, tool_name, payload) + `daily_summaries` (client_id+summary_date único, summary, structured jsonb) + `lp_events` (espelho NO-PII dos eventos de tracking; event_id único, utm_*, country, value, currency, has_email/has_phone flags).

**Funções/RPC:** `set_updated_at()`; `claim_agent_job(worker)` e `claim_autonomous_watch(worker)`
(SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`, EXECUTE revogado de anon/authenticated) para claim
atômico sob concorrência. **Storage buckets:** `creatives` (privado), `nexus-review` (privado,
prints do review), `landing-assets` (público, assets de LP), `ad-ingest` (público — a Meta busca
a imagem do criativo aqui; ADR 0003). **Seed:** uma linha em `clients` para `cliente-exemplo`.

---

## 7. Variáveis de ambiente (contrato)

Fonte canônica: **`.env.example`** (mantenha-o sempre completo). Regras: segredos nunca no
código; `NEXT_PUBLIC_*` são expostas ao browser (nunca coloque segredo aí); o runner recebe
tudo via `fly secrets`; o dashboard via env do Vercel. Modelos do Nexus configuráveis por
`NEXUS_MODEL` / `NEXUS_REVIEW_MODEL` (default `claude-sonnet-4-6` no código).

---

## 8. Plano de construção — ondas

> Cada onda é uma vertical slice entregável e testável. Faça commit atômico por onda (Conventional
> Commits) e só avance com os critérios de aceite verdes.

### Onda 0 — Fundações do repositório
- **Objetivo:** monorepo com tooling, contrato de env e documentação base.
- **Entregáveis:** estrutura de pastas (§5); TS estrito (`strict`, `noUncheckedIndexedAccess`); ESLint+Prettier; Vitest; `.env.example`; `CLAUDE.md` + `.claude/rules/*`; esqueleto `docs/` (Diátaxis); `.gitignore` (inclui `.env.local`).
- **Critérios de aceite:** `lint`, `typecheck` e `test` rodam (sem testes ainda) verdes; `.env.example` lista todas as chaves da §2.
- **Prompt Claude Code:** *"Crie a estrutura de monorepo descrita na SPEC-000 §5: configure TypeScript estrito, ESLint+Prettier, Vitest, .gitignore, e um .env.example com todas as variáveis da §2/§7. Crie o esqueleto docs/ (adr, specs, how-to, reference, explanation, tutorials, security/threats). Não implemente features ainda."*

### Onda 1 — Camada de dados (Supabase)
- **Objetivo:** o schema inteiro da §6 como migrations versionadas + seed do cliente exemplo.
- **Entregáveis:** `supabase/migrations/*.sql` (ordem cronológica), RLS deny-by-default em tudo, trigger `set_updated_at`, RPCs `claim_agent_job`/`claim_autonomous_watch`, buckets, seed `cliente-exemplo`. ADR "persistência Supabase" + ADR "fila agent_jobs".
- **Contratos:** §6 (tabelas, enums/checks, índices únicos parciais, FKs com on-delete).
- **Critérios de aceite:** `supabase db reset` aplica tudo limpo; `select` em cada tabela como `service_role` funciona e como anon falha; `claim_agent_job` claima atômico; seed presente.
- **Prompt:** *"Implemente as migrations Supabase exatamente como a SPEC-000 §6: todas as tabelas, enums/checks, FKs (on-delete corretos), índices (inclusive os únicos parciais de agent_jobs), RLS habilitado deny-by-default, trigger set_updated_at, as RPCs claim_agent_job e claim_autonomous_watch (SECURITY DEFINER, FOR UPDATE SKIP LOCKED, EXECUTE revogado de anon/authenticated), os buckets de storage e o seed do cliente-exemplo. Escreva o ADR de persistência."*

### Onda 2 — Runtime de skills + primeira skill (tráfego)
- **Objetivo:** rodar uma skill headless que cria uma campanha de tráfego PAUSED via MCP da Meta e persiste no Supabase.
- **Entregáveis:** `lista-de-clientes`, `lista-de-produtos`, briefs de produto em `materiais-das-empresas/<cliente>/produtos/`; subagents `scrape-extractor`, `copywriter`, `image-prompt-generator`; skill `image-generate`; skill `create-traffic-<cliente>-campaign`. Persistência via REST/`SUPABASE_SECRET_KEY` (headless **não** usa MCP do Supabase) + manifest JSON.
- **Contratos:** campanha **nasce PAUSED**, orçamento ≤ `daily_budget_cap_cents`, imagem inline em `link_data.picture`, 3 ângulos (autoridade/dor/oferta); grava `campaigns/ad_sets/ads/creatives/generated_images/operation_logs`.
- **Critérios de aceite:** `claude -p ".claude/skills/create-traffic-<cliente>-campaign"` cria a campanha PAUSED, escreve as linhas no banco e o manifest; nenhuma escrita Meta fora do teto; idempotente o suficiente para re-rodar sem duplicar gasto.
- **Prompt:** *"Implemente a skill create-traffic-<cliente>-campaign conforme SPEC-000 §8 Onda 2 e §10: scrape da landing (subagent), copy (subagent), 3 criativos (image-generate), criação via MCP da Meta SEMPRE PAUSED dentro do teto de orçamento, persistência no Supabase via REST com SUPABASE_SECRET_KEY, manifest e operation_logs. Crie também lista-de-clientes, lista-de-produtos e os subagents necessários."*

### Onda 3 — Runner Fly.io (cron + fila)
- **Objetivo:** executar skills headless por cron e por fila, com telemetria.
- **Entregáveis:** `Dockerfile` (node:22, Claude Code CLI, supercronic, wrangler, playwright, tsx), `fly.toml` (machine gru, volume persistente p/ credenciais OAuth do Claude), `crontab`, `scripts/run-skill.sh`, `scripts/poll-agent-jobs.sh`, `scripts/emit-from-stream.py`, hook `emit-agent-event.py`. ADR "runner supercronic" + ADR "fila agent_jobs".
- **Contratos:** `run-skill.sh` valida skill on-disk + charset dos args, roda `claude -p --dangerously-skip-permissions --output-format stream-json`, faz tee de log, emite `agent_events`; `poll-agent-jobs.sh` usa lock mkdir + `claim_agent_job`, executa 1 job/min, patcha status (pending→running→completed/failed) com trap de crash.
- **Critérios de aceite:** um job inserido em `agent_jobs` é claimado, executado e marcado `completed`; cron dispara a skill da Onda 2; `agent_events` recebe start/end; jobs duplicados barrados pelo índice único parcial.
- **Prompt:** *"Implemente o runner Fly.io da SPEC-000 §8 Onda 3 e §10: Dockerfile, fly.toml, crontab e os scripts run-skill.sh / poll-agent-jobs.sh / emit-from-stream.py + hook emit-agent-event.py, com lock, claim atômico, validação de skill/args, timeout, telemetria em agent_events e trap de falha. Escreva o ADR do runner."*

### Onda 4 — Analytics (funil + resumo diário)
- **Objetivo:** análise diária read-only com funil de conversão e resumo para o dashboard.
- **Entregáveis:** skill `funnel-analytics-<cliente>-campaign` (grava `analyses`, `metric_snapshots`, `analysis_findings`, `funnel_events`) e `daily-summary-<cliente>` (upsert `daily_summaries`); crons no `crontab`. ADR funil (0025) + ADR daily-all-campaigns.
- **Contratos:** **só lê** a Meta (allowed-tools sem writes); diagnóstico cruza ≥2 métricas ancorado no north-star do objetivo; funil 7 etapas com CVR por etapa; Telegram opcional com fallback log-only.
- **Critérios de aceite:** rodar a skill grava 1 `analyses` + N snapshots + findings + 7 `funnel_events`/entidade; nenhuma mutação na conta Meta; manifest escrito.
- **Prompt:** *"Implemente funnel-analytics-<cliente>-campaign e daily-summary-<cliente> conforme SPEC-000 §8 Onda 4 e §6 (analytics): leitura read-only via MCP da Meta, extração do funil de 7 etapas com receita/ROAS, diagnóstico cruzando ≥2 métricas, persistência em analyses/metric_snapshots/analysis_findings/funnel_events e upsert em daily_summaries. Adicione os crons."*

### Onda 5 — Ativação + campanha de vendas
- **Objetivo:** colocar campanha no ar (gasto real, com confirmação) e criar campanha de vendas reusando top criativos.
- **Entregáveis:** skill `activate-campaign-<cliente>` (kind `activate`) e `create-sales-<cliente>-campaign` (kind `create_sales`, OUTCOME_SALES, pixel PURCHASE, reusa creative_id vencedores).
- **Contratos:** ativação revalida (cliente correto, PAUSED, dentro do teto) e **aborta por padrão na dúvida**; vendas seleciona top-N criativos por compras e **omite `destination_type`** (Meta v25).
- **Critérios de aceite:** ativação só liga o que passou em todas as validações e loga `action=activate`; vendas cria entidades PAUSED reusando criativos existentes.
- **Prompt:** *"Implemente activate-campaign-<cliente> e create-sales-<cliente>-campaign conforme SPEC-000 §8 Onda 5 e §10, com revalidação de segurança na ativação e reuso de top criativos na de vendas (OUTCOME_SALES, omitir destination_type)."*

### Onda 6 — Dashboard (Vercel) + auth
- **Objetivo:** operador vê clientes, campanhas, análises, funil e logs, atrás de auth.
- **Entregáveis:** `web/` Next.js 15; `middleware.ts` (gate de sessão + headers de segurança/CSP com nonce); auth (senha → `DASHBOARD_PASSWORD` hash + cookie JWT assinado com `AUTH_SECRET` + Turnstile opcional); `lib/db`, `lib/env.ts`, `lib/services/*` (leituras server-side via service_role), `lib/ratelimit` (Upstash); páginas dashboard (overview, analyses, funnel, landing-pages, clients/[slug]); API Hono em `app/api/[[...route]]/route.ts`. ADRs dashboard + auth.
- **Contratos:** todas as leituras de tabela são server-side (RLS fechada ao browser); rota protegida = auth → authz → validação → lógica; headers HSTS/CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy em todas as respostas; rate limit no login.
- **Critérios de aceite:** login funciona; rotas protegidas exigem sessão; `npm run build` + `typecheck` + `lint` verdes; dashboard renderiza dados do seed.
- **Prompt:** *"Implemente o dashboard web/ conforme SPEC-000 §8 Onda 6 e §10: Next.js 15 App Router, middleware com CSP por nonce e headers de segurança, auth por senha (hash) + cookie JWT + Turnstile opcional, serviços de leitura server-side via SUPABASE_SECRET_KEY, rate limit no login, e as páginas overview/analyses/funnel/landing-pages/clients. API via Hono."*

### Onda 7 — Assistente de voz Nexus
- **Objetivo:** falar com o sistema; tools de leitura diretas e de escrita que **enfileiram** jobs.
- **Entregáveis:** `lib/nexus/` (prompt, chat loop, tools, memory, stt, tts, wake-word) e `components/nexus/` (widget, visualizer, voice hook, VAD); endpoints `api/nexus/{chat,stt,tts,capture,narrations,...}`; vision por captura de tela. ADRs voz/VAD/screen-vision.
- **Contratos:** tools de escrita (criar/ativar/landing) **só inserem em `agent_jobs`**, com **confirmação em dois turnos**; o nome da skill é resolvido por **allowlist server-side por slug** (nunca texto livre); args com charset restrito; sem `confirm=true` livre.
- **Critérios de aceite:** comando de voz "analisar cliente-exemplo" retorna métricas reais; "criar campanha" exige confirmação e então cria uma linha em `agent_jobs` que o runner executa; injeção de prompt na fala/tela é tratada como dado, não instrução.
- **Prompt:** *"Implemente o assistente Nexus conforme SPEC-000 §8 Onda 7 e §10: pipeline de voz (VAD, STT Whisper, TTS ElevenLabs, wake word), chat loop com tools de leitura (diretas) e de escrita (apenas enfileiram agent_jobs, confirmação em dois turnos, allowlist slug→skill server-side), memória de sessão e captura de tela para visão. Endpoints Hono em api/nexus/*."*

### Onda 8 — Sistema de landing pages
- **Objetivo:** gerar e publicar landing pages de alta conversão.
- **Entregáveis:** `packages/lp-render` (`@template/lp-render`: tipos ContentDoc/Theme/Settings, 17 seções, serializer ContentDoc→`messages/pt.json`+`content-spec.json`+`theme.css`, libs checkout/affiliate/utm/consent); `landing-pages/_template` (Next.js static export); subagents `landing-page-architect` + `lp-copywriter`; skills `create-landing-page-<cliente>` (escreve rascunho no Supabase + enfileira publish) e `publish-landing-page-<cliente>` (serializa → `next build` → wrangler deploy no Cloudflare Pages). ADRs 0012/0013/0015/0017.
- **Contratos:** conteúdo vive no Supabase (`landing_pages.settings/theme` + `landing_page_sections.fields`), **não** em arquivos; criar nasce `noindex=true` (preview); publicar serializa do banco e faz deploy `<subdomain>.example.com`; go-live (indexável) é passo manual; serializer roda com `tsx`.
- **Critérios de aceite:** `create-landing-page` grava rascunho + job `landing_publish`; `publish` builda e publica uma página acessível (200) em preview; `_template` builda (`next build`) verde.
- **Prompt:** *"Implemente o sistema de landing pages da SPEC-000 §8 Onda 8 e §10: pacote @template/lp-render (ContentDoc + 17 seções + serializer + libs de checkout/UTM/consent), o template static-export, os subagents de arquitetura e copy, e as skills create-landing-page-<cliente> (rascunho no Supabase + enfileira publish, noindex) e publish-landing-page-<cliente> (serializa do banco → next build → wrangler deploy no Cloudflare Pages)."*

### Onda 9 — Editor de landing + modo autônomo do Nexus
- **Objetivo:** editar a LP pelo dashboard e deixar o Nexus narrar/revisar tarefas longas sozinho.
- **Entregáveis:** editor em `components/landing/` + API de edição (`lib/api/landing-pages.ts`, validação Zod por seção, `edit-path`, `reconcile`); `lib/nexus/{autonomous-mode,review-frame,live-review}`; skill `autonomous-watch-tick`; `scripts/poll-autonomous-watches.sh`; `scripts/screenshot-page.cjs` (Playwright, SSRF-guard `*.example.com`); `scripts/send-email.cjs` (Resend). ADRs 0019/0020.
- **Contratos:** edições de rascunho síncronas; publish é job pesado enfileirado; watch é fase máquina (`watching→reviewing→notifying→done`), 1 narração por tick, idempotente por cursores, fail-safe (email/telegram degradam para log).
- **Critérios de aceite:** editar um campo no dashboard atualiza `landing_page_sections`; iniciar modo autônomo cria `autonomous_watches`; cada tick insere ≤1 `nexus_narrations` e avança a fase; o browser faz polling e fala.
- **Prompt:** *"Implemente o editor de landing no dashboard e o modo autônomo do Nexus conforme SPEC-000 §8 Onda 9 e §10: edição validada por seção (Zod + edit-path + reconcile), a skill autonomous-watch-tick (máquina de fases watching/reviewing/notifying/done, idempotente, 1 narração por tick), o poller de watches, o screenshotter Playwright com SSRF-guard e o envio de email opcional."*

### Onda 10 — Tracking server-side (Cloudflare Worker)
- **Objetivo:** coletar eventos das landing pages e espelhar no Supabase sem PII.
- **Entregáveis:** `worker/track/` (endpoint `/e`, CORS para `*.example.com`, rate limit por IP, D1 + fan-out CAPI/GA4/Google Ads, escrita em `lp_events`); `wrangler.toml` (`track.example.com`, `ALLOWED_ORIGIN_SUFFIX`). ADR 0021 / SPEC-015. Chaves de cookie/storage com prefixo neutro (`lp_*`).
- **Contratos:** `lp_events` **sem PII** (só flags `has_email`/`has_phone`, utm_*, country, value); segredos por LP num cofre RLS-locked (fase posterior).
- **Critérios de aceite:** um POST em `/e` valida origem, grava `lp_events` e responde; sem PII em `lp_events`.
- **Prompt:** *"Implemente o Worker de tracking da SPEC-000 §8 Onda 10 e ADR 0021: endpoint /e com CORS por sufixo de domínio, rate limit, D1, fan-out para CAPI/GA4/Google Ads e espelho NO-PII em lp_events. wrangler.toml com track.example.com."*

### Onda 11 — Hardening, observabilidade & CI/CD
- **Objetivo:** colocar em produção com segurança, testes e pipelines.
- **Entregáveis:** threat models STRIDE em `docs/security/threats/`; rate limits revisados; logs estruturados sem PII + correlation/run ids (já em `agent_events`); testes (unit em domain/application, integração no que tem I/O, e2e seletivo); GitHub Actions (lint+typecheck+test+secret scan) → deploy Vercel + Fly; `vercel.json` (crons declarativos).
- **Critérios de aceite:** CI verde obrigatório para merge; cobertura mínima em domain/application; nenhum segredo no diff (gitleaks); threat model por superfície nova.
- **Prompt:** *"Implemente a Onda 11 da SPEC-000: threat models STRIDE por superfície, rate limits, CI no GitHub Actions (lint, typecheck, test, secret scan) com deploy para Vercel e Fly, vercel.json com crons, e a suíte de testes seguindo a pirâmide (muito unit, médio integração, pouco e2e)."*

---

## 9. Sequência de dependências (resumo)

Onda 0 → 1 (dados) → 2 (1ª skill) → 3 (runner) → 4 (analytics) → 5 (ativação/vendas) →
6 (dashboard) → 7 (Nexus) → 8 (landing) → 9 (editor + autônomo) → 10 (tracking) → 11 (hardening).
Ondas 2 e 6 podem começar em paralelo após a 1, mas 3 precede a operação real (cron/fila) e
6 precede 7. 8 precede 9 e 10.

---

## 10. Contratos por componente (referência rápida)

**Skills (todas):** headless-safe (sem `AskUserQuestion`), `--dangerously-skip-permissions`,
persistência via REST + `SUPABASE_SECRET_KEY` (não MCP), manifest JSON em
`tentativas-geracao-de-campanhas/<stamp>-<tipo>.json`, `operation_logs` por mutação, idempotência.

**Fila (`agent_jobs`):** dashboard insere `{client_id, skill, kind, args, status:'pending', requested_by:'nexus'}`;
runner faz `claim_agent_job` → executa → patcha. Kinds: create, create_sales, activate, analyze,
summarize, landing, landing_publish, landing_edit. Dedup por índice único parcial.

**Nexus tools (allowlist server-side):** `CREATE/SALES/ACTIVATE/ANALYZE/LANDING/PUBLISH_SKILL_BY_SLUG`
mapeiam `slug → nome-de-skill`. Tools de escrita só enfileiram, com confirmação em dois turnos.
Tool de leitura retorna JSON puro. `capture_screen` é client-side (pausa o loop).

**Landing (ContentDoc):** `{ settings, theme, sections[] }` persistido em `landing_pages` +
`landing_page_sections`; serializado por `@template/lp-render` para `messages/pt.json` +
`content-spec.json` + `theme.css`; build static export → Cloudflare Pages `<subdomain>.example.com`.

**Runner (Fly):** supercronic lê `crontab`; `poll-agent-jobs.sh` (1 job/min, lock, claim, trap);
`poll-autonomous-watches.sh` (1 watch/tick, cadência ~90s); `run-skill.sh` → `claude -p ... stream-json`
→ `emit-from-stream.py` → `agent_events`.

**Gotchas da Meta (críticos):** campanha sempre nasce PAUSED; imagem inline em `link_data.picture`;
em OUTCOME_SALES **omitir `destination_type`**; Advantage+ = omitir placements/publisher_platforms;
a Meta busca a imagem do criativo num bucket **público** (`ad-ingest`).

---

## 11. Requisitos transversais (valem em todas as ondas)

- **Segurança (Security by Design):** auth → authz → validação → lógica; validação por schema
  tipado em toda fronteira (Zod/Pydantic); RLS deny-by-default; least privilege; segredos fora
  do código; headers de segurança em todas as respostas; rate limit em endpoints públicos;
  threat model STRIDE por superfície nova. Ver `.claude/rules/security.md`.
- **Observabilidade:** logs estruturados sem PII; correlation/run ids (`agent_events.run_id`);
  métricas em fluxos críticos; nunca PII em log.
- **Testes:** pirâmide (muito unit, médio integração, pouco e2e); `domain/` e `application/`
  testados; bug fix começa por teste que reproduz. Ver `.claude/rules/testing.md`.
- **Qualidade:** TS estrito sem `any` injustificado; código em inglês; separation of concerns;
  commits atômicos (Conventional Commits); edits mínimos. Ver `.claude/rules/code-style.md`.
- **Docs as Code:** spec por feature antes do código; ADR (Nygard) por decisão estrutural;
  API-first (contratos antes do handler); estrutura Diátaxis.

---

## 12. Critérios de aceite globais (o sistema está "pronto")

1. `cd web && npm run lint && npm run typecheck && npm run build && npm test` — verdes.
2. `supabase db reset` aplica todas as migrations limpo; seed do `cliente-exemplo` presente.
3. Um job em `agent_jobs` é executado pelo runner e marcado `completed`, com `agent_events` e
   `operation_logs` correspondentes.
4. A skill de tráfego cria uma campanha **PAUSED** dentro do teto; a de análise grava o funil;
   a de landing gera e publica uma página em preview.
5. O dashboard autentica, mostra dados reais do banco e o Nexus responde por voz e enfileira
   trabalho com confirmação em dois turnos.
6. Varredura de segredos no diff vazia; nenhuma PII em logs/`lp_events`.

---

## 13. Mapa para os documentos detalhados (já no repo)

Cada onda tem aprofundamento nos ADRs e specs existentes — use-os como fonte de detalhe ao
construir (e reproduza-os como saída se estiver partindo do zero):

- **ADRs** `docs/adr/`: 0001 runner supercronic · 0002 schema persistência · 0003 bucket público de ingest · 0004 schema de análise · 0005 dashboard Vercel · 0006 auth do dashboard · 0009 fila agent_jobs · 0012 landing no Cloudflare Pages · 0013 design system da LP · 0014 catálogo de produtos como arquivos · 0015 LP editável no Supabase · 0016 tabela products · 0017 pacote @template/lp-render · 0019 modo autônomo do Nexus · 0020 live review · 0021 tracking server-side · 0024 análise diária de todas as campanhas · 0025 funil de conversão.
- **Specs** `docs/specs/`: SPEC-011 geração de LP · SPEC-012 editor de LP · SPEC-013 modo autônomo · SPEC-014 live review · SPEC-015 tracking · SPEC-016 voice chat · flyio-cron-campaign-runner · meta-ads-funnel-analytics · meta-ads-persistence-schema · web-dashboard-nexus.
- **How-to/Tutorials/Reference:** `docs/how-to/setup-do-zero.md` (preencher credenciais e tornar o template seu), `docs/tutorials/deploying-fly-runner-from-scratch.md`, `docs/reference/runner-reference.md`.
- **Threat models:** `docs/security/threats/` (flyio-runner, web-dashboard, landing-page-editor, landing-page-tracking, nexus-screen-vision).
