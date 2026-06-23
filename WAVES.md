# WAVES.md — Roadmap de construção (SPEC-000)

> Painel de controle do build **spec-driven em ondas**. Trabalhe **uma onda por vez**, em ordem.
> Só marque ✅ quando os critérios de aceite da onda passarem. Detalhe completo de cada onda em
> [`SPEC-000-build-from-scratch.md`](./SPEC-000-build-from-scratch.md) §8.
>
> Legenda de status: ⬜ pendente · 🟡 em progresso · ✅ aceita
>
> Protocolo por onda: **spec/ADR primeiro → implementar → validar gate → commit atômico → marcar ✅**.

---

## Dependências (SPEC-000 §9)

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11
```
Ondas 2 e 6 podem começar em paralelo após a 1; 3 precede a operação real (cron/fila);
6 precede 7; 8 precede 9 e 10.

---

## Status das ondas

| # | Onda | Status | Spec / ADR |
|---|------|--------|------------|
| 0 | Fundações do repositório | ✅ | `docs/specs/` index, `.env.example` |
| 1 | Camada de dados (Supabase) | ✅ | ADR 0002/0003/0004/0009 · spec meta-ads-persistence-schema |
| 2 | Runtime de skills + 1ª skill (tráfego) | 🟡 | spec create-traffic-campaign |
| 3 | Runner Fly.io (cron + fila) | 🟡 | ADR 0001/0009 · spec flyio-cron-campaign-runner |
| 4 | Analytics (funil + resumo diário) | 🟡 | ADR 0024/0025 · spec meta-ads-funnel-analytics |
| 5 | Ativação + campanha de vendas | ⬜ | — |
| 6 | Dashboard (Vercel) + auth | 🟡 | ADR 0005/0006 · spec web-dashboard-nexus |
| 7 | Assistente de voz Nexus | 🟡 | SPEC-016 voice chat |
| 8 | Sistema de landing pages | 🟡 | ADR 0012/0013/0015/0017 · SPEC-011 |
| 9 | Editor de LP + modo autônomo | ⬜ | ADR 0019/0020 · SPEC-012/013/014 |
| 10 | Tracking server-side (Cloudflare Worker) | 🟡 | ADR 0021 · SPEC-015 |
| 11 | Hardening, observabilidade & CI/CD | ⬜ | docs/security/threats/* |

> **Build paralelo — 1ª leva (2026-06-23).** Specs + ADRs **redigidos** para as ondas
> 2, 3, 4, 6, 7, 8, 9, 10 (status `draft`/`proposed`). **Scaffolds offline** entregues e com gate
> local verde para 2 (`packages/skill-kit` + skill/subagents), 6 (`web/`) e 8 (`packages/lp-render`).
>
> **Build paralelo — 2ª leva (2026-06-23, 3 worktrees + agents).** Implementação **offline** das ondas
> em 3 frentes disjuntas, integradas na `main` com gate global verde (lint ✓ · typecheck ✓ · test ✓):
> **A** 2/3/4 (orquestrador de tráfego + portas injetáveis; infra runner Fly + helpers Python testados;
> analytics funil read-only) · **B** 7 (Nexus: chat-loop/tools/allowlist/confirmação-2-turnos atrás de
> interfaces, tools de escrita só enfileiram) + **fix de segurança do login W6** (degrada para POST,
> senha não vaza na URL) · **C** 8 (template React static-export das 17 seções + skills create/publish)
> e 10 (worker de tracking Cloudflare NO-PII). Testes: web 57 · lp-render 70 · skill-kit 136 · worker 45.
> Todas seguem 🟡 **em progresso**, não ✅: o **e2e** depende de credenciais externas (Meta MCP headless +
> materiais, env CrokoAI, Fly, Cloudflare, OpenAI/ElevenLabs — ver `NOTES.md` §7). Identidade visual Croko
> aplicada como tema default em `web/` e `lp-render` (camada visual; placeholders textuais mantidos).

---

## Detalhe por onda (objetivo · entregáveis · gate de aceite)

### Onda 0 — Fundações do repositório  ✅
- **Objetivo:** monorepo com tooling, contrato de env e documentação base.
- **Entregáveis:** estrutura de pastas (§5); TS estrito (`strict`, `noUncheckedIndexedAccess`);
  ESLint+Prettier; Vitest; `.env.example`; `CLAUDE.md` + `.claude/rules/*`; esqueleto `docs/`
  (Diátaxis); `.gitignore` (inclui `.env.local`).
- **Gate:** `lint`, `typecheck` e `test` verdes (sem testes ainda); `.env.example` lista todas as
  chaves da §2.

### Onda 1 — Camada de dados (Supabase)  ✅
- **Objetivo:** schema inteiro da §6 como migrations versionadas + seed do cliente exemplo.
- **Entregáveis:** `supabase/migrations/*.sql`, RLS deny-by-default, trigger `set_updated_at`,
  RPCs `claim_agent_job`/`claim_autonomous_watch`, buckets, seed `cliente-exemplo`, ADRs.
- **Gate:** `supabase db reset` aplica limpo; `select` como `service_role` ok e como anon falha;
  `claim_agent_job` atômico; seed presente.
- **Aceita em 2026-06-22.** 10 migrations + 20 tabelas; gate verde via `scripts/verify-wave1.sql`
  (RLS 20/20, service_role lê / anon `permission denied`, claim atômico, índice único parcial,
  append-only, buckets). Validado contra Supabase **local** (Docker + CLI 2.72.7).
- **Aplicada ao projeto remoto em 2026-06-23** via MCP Supabase (projeto **CrokoAI**,
  ref `smixacjjoaniaxrjcreq`, sa-east-1). 11 migrations no histórico remoto (10 originais +
  `harden_function_search_path`), versões re-stampadas para baterem com os arquivos locais. Gate
  remoto verde (20/20 RLS, buckets, seed, claim, índice parcial, append-only). Advisors de
  segurança: só os 20 `rls_enabled_no_policy` (INFO, esperado pelo deny-by-default); WARN de
  `function_search_path_mutable` corrigido. **Pendência:** artefato pré-existente `rls_auto_enable()`
  (event trigger `ensure_rls`, não nosso) — ver NOTES §4.

### Onda 2 — Runtime de skills + 1ª skill (tráfego)  ⬜
- **Objetivo:** skill headless cria campanha de tráfego **PAUSED** via MCP Meta e persiste.
- **Entregáveis:** `lista-de-clientes`, `lista-de-produtos`, briefs; subagents `scrape-extractor`,
  `copywriter`, `image-prompt-generator`; skills `image-generate` e
  `create-traffic-<cliente>-campaign`; persistência REST + `SUPABASE_SECRET_KEY` + manifest.
- **Gate:** `claude -p` cria campanha PAUSED dentro do teto, grava banco + manifest, idempotente.

### Onda 3 — Runner Fly.io (cron + fila)  ⬜
- **Objetivo:** executar skills headless por cron e por fila, com telemetria.
- **Entregáveis:** `Dockerfile`, `fly.toml`, `crontab`, `scripts/run-skill.sh`,
  `scripts/poll-agent-jobs.sh`, `scripts/emit-from-stream.py`, hook `emit-agent-event.py`, ADRs.
- **Gate:** job inserido em `agent_jobs` é claimado→executado→`completed`; cron dispara skill da
  Onda 2; `agent_events` recebe start/end; duplicados barrados pelo índice único parcial.

### Onda 4 — Analytics (funil + resumo diário)  ⬜
- **Objetivo:** análise diária read-only com funil de conversão + resumo para o dashboard.
- **Entregáveis:** skills `funnel-analytics-<cliente>-campaign` e `daily-summary-<cliente>`; crons.
- **Gate:** rodar grava 1 `analyses` + N `metric_snapshots` + findings + 7 `funnel_events`/entidade;
  **nenhuma mutação** Meta; manifest escrito.

### Onda 5 — Ativação + campanha de vendas  ⬜
- **Objetivo:** colocar campanha no ar (gasto real, confirmado) + campanha de vendas reusando top criativos.
- **Entregáveis:** skills `activate-campaign-<cliente>` (kind `activate`) e
  `create-sales-<cliente>-campaign` (kind `create_sales`, OUTCOME_SALES, pixel PURCHASE).
- **Gate:** ativação só liga o que passou nas validações e loga `action=activate`; vendas cria
  entidades PAUSED reusando criativos (omite `destination_type`).

### Onda 6 — Dashboard (Vercel) + auth  ⬜
- **Objetivo:** operador vê clientes/campanhas/análises/funil/logs atrás de auth.
- **Entregáveis:** `web/` Next.js 15; `middleware.ts` (sessão + CSP por nonce + headers); auth
  (senha→hash + cookie JWT + Turnstile opcional); `lib/db`, `lib/env.ts`, `lib/services/*`,
  `lib/ratelimit`; páginas; API Hono em `app/api/[[...route]]/route.ts`; ADRs.
- **Gate:** login funciona; rotas protegidas exigem sessão; `build`+`typecheck`+`lint` verdes;
  renderiza dados do seed.

### Onda 7 — Assistente de voz Nexus  ⬜
- **Objetivo:** falar com o sistema; tools de leitura diretas e de escrita que **enfileiram** jobs.
- **Entregáveis:** `lib/nexus/*` (prompt, chat loop, tools, memory, stt, tts, wake-word),
  `components/nexus/*`, endpoints `api/nexus/{chat,stt,tts,capture,narrations,...}`, vision por tela.
- **Gate:** "analisar cliente-exemplo" retorna métricas reais; "criar campanha" exige confirmação
  em dois turnos → linha em `agent_jobs`; allowlist slug→skill server-side; injeção tratada como dado.

### Onda 8 — Sistema de landing pages  ⬜
- **Objetivo:** gerar e publicar landing pages de alta conversão.
- **Entregáveis:** `packages/lp-render` (`@template/lp-render`: ContentDoc/Theme/Settings, 17 seções,
  serializer, libs checkout/affiliate/utm/consent); `landing-pages/_template`; subagents
  `landing-page-architect`+`lp-copywriter`; skills `create-landing-page-<cliente>` e
  `publish-landing-page-<cliente>`; ADRs.
- **Gate:** create grava rascunho + job `landing_publish`; publish builda e serve 200 em preview;
  `_template` builda verde.

### Onda 9 — Editor de LP + modo autônomo do Nexus  ⬜
- **Objetivo:** editar a LP pelo dashboard + Nexus narrar/revisar tarefas longas sozinho.
- **Entregáveis:** editor `components/landing/*` + API de edição (Zod por seção, `edit-path`,
  `reconcile`); `lib/nexus/{autonomous-mode,review-frame,live-review}`; skill
  `autonomous-watch-tick`; `scripts/poll-autonomous-watches.sh`; `scripts/screenshot-page.cjs`
  (SSRF-guard `*.example.com`); `scripts/send-email.cjs`; ADRs.
- **Gate:** editar campo → `landing_page_sections`; iniciar autônomo cria `autonomous_watches`;
  cada tick insere ≤1 `nexus_narrations` e avança a fase.

### Onda 10 — Tracking server-side (Cloudflare Worker)  ⬜
- **Objetivo:** coletar eventos das LPs e espelhar no Supabase **sem PII**.
- **Entregáveis:** `worker/track/` (endpoint `/e`, CORS `*.example.com`, rate limit por IP, D1,
  fan-out CAPI/GA4/Google Ads, escrita em `lp_events`); `wrangler.toml` (`track.example.com`); ADR.
- **Gate:** POST `/e` valida origem, grava `lp_events` e responde; **sem PII** em `lp_events`.

### Onda 11 — Hardening, observabilidade & CI/CD  ⬜
- **Objetivo:** produção com segurança, testes e pipelines.
- **Entregáveis:** threat models STRIDE em `docs/security/threats/`; rate limits revisados; logs
  estruturados sem PII + correlation/run ids; testes (pirâmide); GitHub Actions
  (lint+typecheck+test+secret scan) → deploy Vercel + Fly; `vercel.json` (crons declarativos).
- **Gate:** CI verde obrigatório para merge; cobertura mínima em domain/application; nenhum segredo
  no diff (gitleaks); threat model por superfície nova.

---

## Critérios globais de "pronto" (SPEC-000 §12)

1. `cd web && npm run lint && npm run typecheck && npm run build && npm test` — verdes.
2. `supabase db reset` aplica todas as migrations limpo; seed `cliente-exemplo` presente.
3. Job em `agent_jobs` executado pelo runner e marcado `completed`, com `agent_events` e `operation_logs`.
4. Skill de tráfego cria campanha **PAUSED** no teto; análise grava o funil; landing publica em preview.
5. Dashboard autentica, mostra dados reais e o Nexus responde por voz e enfileira com confirmação 2-turnos.
6. Varredura de segredos no diff vazia; nenhuma PII em logs/`lp_events`.
