# NOTES.md — Registro persistente de implementação (handoff entre waves)

> **Propósito.** Memória confiável do build que sobrevive a `/compact` e à troca de contexto.
> Atualize este arquivo **ao fim de cada wave** (ou ao tomar qualquer decisão relevante).
> Fontes irmãs: [`SPEC-000-build-from-scratch.md`](./SPEC-000-build-from-scratch.md) (a planta),
> [`WAVES.md`](./WAVES.md) (roadmap + status), [`CLAUDE.md`](./CLAUDE.md) (convenções).
>
> **Última atualização:** 2026-06-24 · **Wave atual:** 1 ✅ + **build paralelo (3 levas)** das ondas
> 2/3/4/5/6/7/8/9/10/11 — implementação **offline** integrada na `main`, gate global verde
> (lint ✓ · typecheck ✓ · test ✓ · **427 testes**), status 🟡 (e2e pendente de credenciais).
> **Não resta nenhuma onda ⬜** — todas as 11 estão offline-completas; falta só destravar os gates de
> operação real com credenciais (§7) e marcar ✅.
> Próximo: destravar gates com credenciais (env CrokoAI, Meta MCP headless + materiais, Fly, Cloudflare,
> OpenAI/ElevenLabs) **ou** revisar o e2e onda a onda.
> **Commits:** 5 + 1ª leva (specs/ADRs · workspaces · scaffolds · tema Croko) + 2ª leva (9 commits de
> ondas via 3 worktrees/agents + 2 de integração) + **3ª leva (3 commits W5/W9/W11 via 3 worktrees/agents,
> cherry-pick limpo na main)**.

---

## 1. Estado atual (resumo executivo)

- **Wave 0 (Fundações) — ✅ aceita e commitada.** Monorepo, contrato de env, tooling e scaffold de
  docs prontos. Gate verde: `typecheck ✓ · lint ✓ · test ✓`.
- **Wave 1 (Camada de dados) — ✅ aceita.** 10 migrations (`supabase/migrations/2026...`), 20 tabelas
  da §6, RLS deny-by-default, triggers `set_updated_at`/`prevent_mutation`, RPCs `claim_agent_job`/
  `claim_autonomous_watch`, 4 buckets, lockdown de grants e seed `cliente-exemplo`. Gate verde via
  `scripts/verify-wave1.sql` contra **Supabase local** (Docker + CLI 2.72.7).
- **Wave 1 aplicada ao REMOTO (2026-06-23) via MCP Supabase.** Projeto **CrokoAI**
  (`smixacjjoaniaxrjcreq`, sa-east-1, Postgres 17). 10 migrations + 1 de hardening
  (`harden_function_search_path`, fixa `search_path` em `set_updated_at`/`prevent_mutation`).
  Versões do histórico remoto **re-stampadas** para baterem com os arquivos locais (o
  `apply_migration` do MCP gera timestamp próprio → re-stamp evita drift no `db push` futuro).
  Gate remoto verde + advisors limpos (só os 20 INFO esperados). **Há um projeto homônimo `CrokoAds`
  e outros 2** na mesma org — confirmar sempre o ref antes de aplicar DDL.
- **Próximo passo:** Wave 2 — Runtime de skills + 1ª skill (tráfego). Depende do banco (✅) e exige
  **MCP da Meta** (`mcp-meta-ads` / `CrokoMediaAdsMCP`) + materiais do `cliente-exemplo`.

---

## 2. Decisões confirmadas com a usuária (valem para todo o build)

1. **Manter placeholders do template** — NÃO substituir pela marca Croko ainda. Seguir fiel a:
   `cliente-exemplo`, produtos `curso-exemplo`/`workshop-exemplo`, assistente **Nexus**, agência
   **Acme**, domínio **example.com**, npm scope **@template**, app Fly **meta-ads-agents**.
   → A troca pela identidade real (Croko Media) é uma tarefa futura, pós-build.
   **EXCEÇÃO (2026-06-23, decisão da usuária):** a camada **VISUAL** (tokens/paleta/fontes do
   `design-system/croko/tokens.css` + MASTER.md) será plugada como **tema default** do dashboard
   (W6) e dos `Theme` defaults do `lp-render` (W8). Os placeholders **TEXTUAIS** (nomes, domínio,
   npm scope, app Fly) **permanecem** — só o visual (cores/fontes/raios/espaçamento) vira Croko.
2. **`.env.local` = template com placeholders + comentários.** Nenhum segredo real escrito por mim;
   preenchimento é manual da usuária. `.env.example` é a fonte canônica versionada.
3. **Escopo = roadmap completo das 12 waves, executando UMA wave por vez** com gate de aceite verde
   antes de avançar. Protocolo: spec/ADR → implementar → validar gate → commit atômico → marcar ✅.

---

## 3. Decisões de implementação (Waves 0–1)

### Wave 0 (tooling/scaffold)

| Decisão | Por quê | Onde / impacto futuro |
|---|---|---|
| **Workspaces npm ainda NÃO habilitados** no `package.json` raiz | `web/`, `packages/*` etc. estão vazios; declarar workspace sem `package.json` quebra `npm install` | Adicionar `"workspaces"` incrementalmente quando cada pacote ganhar seu `package.json` (Waves 6/8) |
| `tsconfig.json` com `include: ["src/**/*.ts", "*.ts"]` + placeholder `src/env-contract.ts` | `tsc --noEmit` falha com "No inputs found" se não houver `.ts` | Ao crescer, cada pacote pode ter seu próprio `tsconfig` estendendo o raiz |
| `vitest.config.ts` com `passWithNoTests: true` | manter `npm test` verde antes da 1ª suíte | Remover/endurecer quando houver testes reais (regra: cobertura em `domain/`/`application/`) |
| ESLint flat config (v9) + `@typescript-eslint/no-explicit-any: 'warn'` | `any` é desencorajado mas não bloqueia o scaffold | Considerar subir para `error` no hardening (Wave 11) |
| `src/env-contract.ts` = espelho **tipado** dos nomes de env (REQUIRED/OPTIONAL) | dá input ao `tsc` e serve de fonte única dos nomes | A validação real (Zod, leitura tipada) entra em `web/lib/env.ts` na **Wave 6** |
| 18 stubs de ADR gerados (status `proposed`) | Docs as Code; reservar numeração da SPEC §13 | Preencher o ADR correspondente ao iniciar cada wave |
| `.gitignore` ignora `.env*` exceto `.env.example`; ignora `venv/`, `node_modules/`, build outputs, `tentativas-geracao-de-campanhas/`, `.claude/logs/` | segredos fora do git; artefatos de runtime das skills fora do git | — |

### Wave 1 (schema Supabase)

| Decisão | Por quê | Onde / impacto futuro |
|---|---|---|
| **Enums via `CHECK` constraint** (não `create type ... enum`) | tipos nativos são chatos de evoluir (`ALTER TYPE` com locks); CHECK evolui por migration simples | Para adicionar um valor de enum: nova migration alterando o CHECK. Documentado no ADR 0004 |
| **`prevent_mutation()`** trigger em `operation_logs`/`agent_events`/`lp_events` | append-only **não** pode depender de RLS — `service_role` tem `BYPASSRLS` e ignoraria policies | Qualquer nova tabela de log/evento deve receber o mesmo trigger |
| **`revoke all ... from anon, authenticated`** + `alter default privileges` (migration `...120900`) | RLS sem policy só retorna **vazio**; revoke faz o `select` anon **falhar** com `permission denied` (intenção "só service_role acessa") | Vale também para objetos futuros no schema `public` |
| **Colunas de scaffolding além da §6**: `id uuid pk`, `created_at`, `updated_at`, `client_id` de escopo, `claimed_by`/`claimed_at` em jobs/watches | a §6 lista "colunas-chave; ver migrations para o DDL exato" → o DDL é a fonte; precisamos de PK/escopo/claim | Manter o padrão nas próximas tabelas |
| **10 migrations por domínio** (ordem cronológica `20260622120000..120900`) | legibilidade + ordem de FK respeitada por nome de arquivo | Novas tabelas: timestamp posterior; respeitar dependências de FK |
| **FK `on delete`**: hierarquia Meta CASCADE; `ads→creatives` e `landing_pages→products` RESTRICT; `creatives→generated_images` SET NULL | apagar pai limpa filhos; não apagar algo ainda referenciado; imagem é opcional | Documentado na spec `meta-ads-persistence-schema` |
| **Seed em `supabase/seed.sql`** (não numa migration) | `config.toml [db.seed]` aplica seed após migrations no `db reset`; mantém DDL ≠ dados | Adicionar mais seeds aqui (idempotentes via `on conflict do nothing`) |

---

## 4. Achados / gotchas do ambiente (IMPORTANTES)

- **Node instalado: v23.11.1** (npm 10.9.2). O **SPEC pede Node 22**. Funciona, mas gera
  `EBADENGINE warning`. ⚠️ Antes de produção, padronizar para Node 22 (ex.: `.nvmrc` + nvm) para
  bater com o `Dockerfile`/`fly.toml` da Wave 3 e o runtime do Vercel.
- **`npm audit`: 6 vulnerabilidades** (3 moderate, 1 high, 2 critical) em deps **transitivas de
  dev**. **NÃO** rodei `audit fix --force` (quebraria versões). Revisar na Wave 11 (hardening).
- **Repo NÃO era git** no início da sessão (`Is a git repository: false`). Foi `git init` agora.
  Commits feitos com `user.name=CroKoAI`, `user.email=karlapazosvendas@gmail.com` (via `-c`, sem
  config global). Sem remote configurado ainda.
- **`design-system/` contém a identidade REAL da Croko** (marca, paleta teal/green `#0a6e75`/`#57cc99`,
  fontes Clash Display + Satoshi, regras de cópia, fatos aprovados 46x/140+/2 países). Está fora do
  fluxo do template, mas será a fonte de verdade visual quando a Wave 8 (landing pages) trocar os
  placeholders pela marca real. Ver `design-system/croko/MASTER.md`.
- **`venv/`** Python pré-existente na raiz (provável uso de scripts Python como
  `emit-from-stream.py`/hooks nas Waves 3/9). Mantido e gitignored.
- **`open-stack-urls.sh`/`.ps1`** pré-existentes: abrem os painéis dos serviços do stack no browser
  (Supabase, Upstash, Fly, Vercel, ElevenLabs, Resend, platform.claude, OpenAI). Útil para a usuária
  criar contas e pegar credenciais.

### Achados da Wave 1 (Supabase local) — IMPORTANTES p/ retomar

- **Supabase CLI v2.72.7** instalada; **Docker Desktop** instalado mas o daemon começou **DOWN** —
  subi com `open -a Docker` (leva ~30–60s). `supabase start` na 1ª vez **baixa as imagens** (alguns
  minutos) e **já aplica migrations + seed**.
- **`supabase db reset --local` FALHA** se o stack não estiver no ar (`supabase start is not running`).
  Fluxo correto: `supabase start` (sobe + aplica tudo) e, para reaplicar do zero com o stack já no ar,
  `supabase db reset`.
- **NÃO há `psql` no PATH do host.** Para rodar SQL, use o `psql` **dentro do container**:
  `docker exec -i supabase_db_CroKoAI psql -U postgres -d postgres ...` (foi assim que rodei o gate
  `scripts/verify-wave1.sql`). DB local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Credenciais locais regeneram** a cada `supabase start` em máquina nova; são **locais-only**
  (inúteis fora de `localhost`). Studio: `http://127.0.0.1:54323`. O bloco impresso pelo `start` tem
  `Publishable`/`Secret` keys e a connection string — é o que vai no `.env.local` para dev local.
- **`config.toml`** gerado por `supabase init` tem `project_id = "CroKoAI"` e `[db.seed]` →
  `./seed.sql`. Versionado. `supabase/.gitignore` (gerado) ignora `.branches`/`.temp`/`.env*.local`.

### Remoto Supabase — artefato pré-existente `rls_auto_enable()` (ORIGEM CONFIRMADA · decidido: MANTER)

- **O que é:** event trigger `ensure_rls` (`ddl_command_end`) → função `public.rls_auto_enable()`
  (`SECURITY DEFINER`, dono `postgres`, `SET search_path TO 'pg_catalog'`). A cada `CREATE TABLE`/
  `CREATE TABLE AS`/`SELECT INTO` no schema `public`, roda `alter table ... enable row level
  security`. É uma **rede de segurança auto-RLS**. **NÃO** veio das nossas migrations.
- **Origem confirmada (2026-06-23):** é um **padrão da org inteira** — a função+trigger existem nos
  **3 projetos ativos**: CrokoAI, **CrokoAds** e **MadameClub** (55 tabelas). Logo é convenção
  aplicada em todo projeto Supabase da usuária, não algo plantado só aqui. Os 6 event triggers padrão
  do Supabase (`pgrst_*`, `issue_pg_*`, `issue_graphql_placeholder`) seguem intactos; `ensure_rls` é
  o único extra.
- **Advisor WARN (0028/0029):** "executável por anon/authenticated via REST". **Falso-positivo
  prático:** função de event trigger só roda em contexto de trigger; chamada via `/rest/v1/rpc/...`
  gera erro — sem escalonamento.
- **Decisão da usuária: MANTER como está** (consistência com CrokoAds/MadameClub). Não alterado.
  O WARN permanecerá nos advisors por design; documentado aqui como decisão consciente.

### MCP disponíveis nesta sessão (claude.ai) — crítico p/ Waves 2+

- **Meta Ads = `mcp__claude_ai_CrokoMediaAdsMCP__*`** (NÃO um CLI `mcp-meta-ads`; a SPEC §10 chama
  genericamente de "mcp-meta-ads"). Tools-chave: `list_ad_accounts`, `select_org`, `create_campaign`,
  `create_adset`, `create_ad`, `create_ad_creative`, `get_insights`, `list_campaigns`, `update_*`,
  `connect_meta`/`auth_status`. **Esse é o caminho da Meta na Wave 2.**
- **⚠️ RISCO Wave 2/3:** MCPs autenticados via **claude.ai** (CrokoMediaAdsMCP, Supabase, Vercel,
  Notion, Gmail, etc.) **podem não existir no runner headless/cron** do Fly.io (Wave 3). A skill de
  tráfego (Wave 2) usa o MCP da Meta de forma interativa aqui; ao migrar p/ headless (Wave 3) é
  preciso **confirmar como o runner autentica a Meta** (token próprio do MCP server? variável?). A
  persistência no Supabase em headless **não** usa MCP — é **REST + `SUPABASE_SECRET_KEY`** (SPEC §10).
- Também conectados: **Supabase MCP** (usei só p/ contexto; migrations foram via CLI), **Vercel MCP**
  (deploy/logs — Wave 6), **higgsfield** (imagem/vídeo — alternativa ao gpt-image?), **claude_design**.

---

## 5. Contratos críticos para LEMBRAR em todas as waves (do SPEC §6/§10/§11)

- **Comunicação entre planos é SÓ via banco.** Sem webhooks/inbound. Dashboard escreve `agent_jobs`;
  runner faz polling, executa, escreve resultado; dashboard lê. Idempotência + locks.
- **Skills:** headless-safe (sem `AskUserQuestion`), `--dangerously-skip-permissions`, persistência
  via **REST + `SUPABASE_SECRET_KEY`** (NÃO MCP do Supabase no headless), manifest JSON,
  `operation_logs` por mutação.
- **Meta (gotchas que quebram tudo se esquecidos):**
  - Campanha **SEMPRE nasce PAUSED**, orçamento ≤ `daily_budget_cap_cents`.
  - Imagem do criativo **inline em `link_data.picture`**; a Meta busca a imagem no bucket
    **público** `ad-ingest`.
  - `OUTCOME_SALES` → **omitir `destination_type`** (Meta v25).
  - Advantage+ → omitir `placements`/`publisher_platforms`.
  - Meta acessada **só via MCP `mcp-meta-ads`** (sem token Meta em env).
- **Dados:** dinheiro em **inteiro de centavos**; IDs externos da Meta em `text`; todo upsert guarda
  `raw_spec jsonb`; tabelas de log/evento são **append-only** (nunca UPDATE); trigger
  `set_updated_at()` onde houver `updated_at`.
- **Segurança:** `auth → authz → validação → lógica`; Zod em toda fronteira; **RLS deny-by-default**
  (só `service_role`); RPCs `claim_*` = `SECURITY DEFINER` + `FOR UPDATE SKIP LOCKED` + EXECUTE
  revogado de anon/authenticated; segredos fora do código; headers de segurança + rate limit;
  **nunca PII em log/`lp_events`**.
- **Nexus:** tools de escrita **só enfileiram** `agent_jobs` com **confirmação em dois turnos**;
  skill resolvida por **allowlist server-side por slug** (nunca texto livre).

---

## 6. Inventário do que existe (pós-Wave 1)

```
# --- Wave 0 (fundações) ---
.env.example          # contrato canônico de env (versionado, 29 chaves)
.env.local            # valores de dev (GITIGNORED) — preencher (ver §7)
.gitignore
package.json          # scripts: lint/typecheck/test/format; devDeps (eslint9, tseslint8, vitest2, prettier3, ts5.6)
tsconfig.json         # strict + noUncheckedIndexedAccess + NodeNext
eslint.config.mjs · .prettierrc.json · .prettierignore · vitest.config.ts (passWithNoTests:true)
CLAUDE.md             # convenções do PROJETO (≠ CLAUDE.md global da usuária)
WAVES.md · NOTES.md   # roadmap+status · este handoff
src/env-contract.ts   # espelho tipado dos nomes de env
.claude/rules/{security,testing,code-style}.md
.claude/{skills,agents,hooks,materiais-das-empresas}/   # vazios (.gitkeep) — preencher na Wave 2
docs/README.md + docs/{adr,specs,how-to,reference,tutorials,explanation,security/threats,templates,sessions}/
  docs/templates/{adr-template,spec-template}.md
  docs/adr/README.md + 18 ADRs (0002/0003/0004/0009 = accepted; demais ainda stubs proposed)
  docs/specs/README.md (índice das 11 specs por wave)

# --- Wave 1 (camada de dados) — NOVO ---
supabase/config.toml          # gerado por `supabase init` (project_id=CroKoAI, [db.seed]→seed.sql)
supabase/.gitignore           # gerado (ignora .branches/.temp/.env*.local)
supabase/seed.sql             # seed cliente-exemplo (idempotente)
supabase/migrations/          # 11 arquivos: 20260622120000..120900 (schema) + 20260623120000_harden_function_search_path
docs/specs/meta-ads-persistence-schema.md   # accepted
docs/adr/000{2,3,4,9}-*.md                   # accepted
docs/security/threats/supabase-data-layer.md # STRIDE da camada de dados
scripts/verify-wave1.sql      # gate executável (RLS/claim/unique/append-only/buckets/seed)

# --- ainda vazios (.gitkeep) ---
web/ · packages/lp-render/ · landing-pages/_template/ · worker/track/
```

**20 tabelas (public):** clients · campaigns/ad_sets/ads · creatives/generated_images ·
analyses/metric_snapshots/analysis_findings/funnel_events · products/landing_pages/landing_page_sections ·
agent_jobs/autonomous_watches/nexus_narrations · operation_logs/agent_events/daily_summaries/lp_events.
**Buckets:** creatives, nexus-review (privados) · landing-assets, ad-ingest (públicos).

> **NÃO confundir:** `CLAUDE.md` (raiz do repo, deste projeto) vs `~/.claude/CLAUDE.md` (global da
> usuária, Synkra AIOS) — o global permanece intocado.

---

## 7. Pendências / inputs necessários antes da próxima wave

- [x] ~~Wave 1: Supabase + CLI~~ — **resolvido via Supabase local** (Docker + CLI 2.72.7).
      Stack local no ar: Studio `http://127.0.0.1:54323`, DB `:54322`. Para subir de novo:
      `supabase start`; reset limpo: `supabase db reset` (com stack no ar).
- [x] ~~**Projeto Supabase remoto** para produção~~ — **criado e migrado**: **CrokoAI**
      (`smixacjjoaniaxrjcreq`, sa-east-1). URL `https://smixacjjoaniaxrjcreq.supabase.co`.
- [ ] **`.env.local` / env de produção:** colar as chaves do projeto remoto **CrokoAI**
      (`SUPABASE_URL`, `SUPABASE_SECRET_KEY` / service_role, publishable key) — pegar no painel
      Supabase (não escritas por mim; segredos fora do git). Para dev local, as chaves **locais** do
      `supabase start` continuam válidas (locais-only).
- [ ] **Wave 2 precisa:** MCP da Meta (`CrokoMediaAdsMCP`/`mcp-meta-ads`) autenticado +
      `materiais-das-empresas/cliente-exemplo/` (logo, fotos, brief `produtos/<slug>.json`) +
      catálogo `lista-de-clientes`/`lista-de-produtos` para destravar o e2e da 1ª skill.
- [x] ~~**CI (W11) nunca executado de verdade**~~ — **validado em 2026-06-24**: push da `main`
      disparou os workflows `ci` e `deploy`. **`ci` (lint·typecheck·test·gitleaks) = success** e o
      **`deploy → quality gate` (lint·typecheck·test) = success**. Bug encontrado e corrigido: action
      do Fly era `superfly/fly-actions` (inexistente) → `superfly/flyctl-actions` (commit `abd6921`).
      Actions bumpadas `checkout@v4→v5` / `setup-node@v4→v5` (warning de Node 20). `gitleaks-action`
      fica em `@v2` (major mais recente; warning de Node é upstream).
- [ ] **Deploy bloqueado SÓ por secrets (configurar no GitHub → Settings → Secrets and variables →
      Actions → repository secrets):** ambos os jobs de `deploy` falham apenas por falta de credencial.
      - **deploy dashboard (Vercel):** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
      - **deploy runner (Fly.io):** `FLY_API_TOKEN`.
      A action do Fly já resolve (`Setup flyctl` ✓); falha só no passo `Deploy to Fly` por token ausente.
      Obs.: o job `deploy` usa `environment: production` — os secrets podem ficar no Environment
      `production` (Settings → Environments) em vez de repository secrets, se preferir gate de aprovação.
- [ ] **Gates bloqueados por credencial (do build paralelo 2026-06-23):**
      - **W6 dashboard:** chaves do projeto **CrokoAI** no env (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
        `NEXT_PUBLIC_SUPABASE_URL`, publishable key) + `AUTH_SECRET` (≥32B) + `DASHBOARD_PASSWORD`
        (hash SHA-256) + Upstash (`UPSTASH_REDIS_REST_URL/TOKEN`) p/ render real e login ponta-a-ponta.
      - **W2/4/5:** Meta MCP + materiais (acima); `OPENAI_API_KEY` p/ a skill `image-generate`.
      - **W3/5:** conta **Fly.io** (deploy do runner) — e validar se o MCP Meta funciona em `claude -p`
        headless no cron (risco aberto do ADR 0001).
      - **W10:** conta **Cloudflare** (Worker + D1).
- [ ] **Hardening (W11):** threat models STRIDE referenciados mas ainda não criados
      (`web-dashboard`, `nexus-screen-vision`, `landing-page-tracking`); revisar `npm audit`
      (8 vulns dev); adicionar `lint` aos packages; consolidar ADRs duplicados `0003`/`0009`.
- [ ] **W6 login — achado de segurança (2026-06-23):** o `login-form` faz **fallback GET nativo**
      se o JS não hidratar → a senha vaza na **URL** (log do servidor, histórico, referrer). Visto no
      dev log como `GET /login?password=...`. Fix: form degradar para `method=POST` (e o endpoint
      aceitar form-encoded além de JSON) + **rotacionar** a senha de teste já usada.
- [ ] (Opcional) Padronizar Node 22 via `.nvmrc`.

---

## 8. Como retomar (após `/compact` ou nova sessão)

1. Ler **NOTES.md** (este arquivo) → **WAVES.md** (status/gates) → **SPEC-000 §8** da wave alvo.
2. Conferir o status no topo (§1) e as pendências (§7).
3. Seguir o **protocolo por wave** (§ topo): escrever/atualizar a spec em `docs/specs/<feature>.md` e
   o ADR correspondente → implementar → rodar o gate de aceite da wave (tabela em WAVES.md) →
   commit atômico (Conventional Commits, `[SPEC-000]`) → marcar ✅ em WAVES.md → **atualizar este
   NOTES.md**.
4. Comandos de sanidade: `npm run typecheck && npm run lint && npm test`.

### Quickstart do banco (Supabase local)

```bash
open -a Docker                       # subir o daemon do Docker (se DOWN), aguardar ~30-60s
supabase start                       # sobe stack + aplica migrations + seed (1ª vez baixa imagens)
supabase db reset                    # reaplica do zero (precisa do stack JÁ no ar)
supabase stop                        # derruba o stack
# rodar SQL (não há psql no host → usar o do container):
docker exec -i supabase_db_CroKoAI psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f scripts/verify-wave1.sql
```
Git: commits sem config global → usar
`git -c user.name=CroKoAI -c user.email=karlapazosvendas@gmail.com commit ...`.

---

## 9. Log de decisões por wave (append-only)

- **Wave 0 (2026-06-22):** fundações criadas; placeholders mantidos; `.env.local` como template;
  workspaces adiados; gate verde; git inicializado. Achados: Node v23 (≠22), 6 vulns dev,
  `design-system/` com marca real Croko, `venv/` pré-existente.
- **Wave 1 (2026-06-22):** schema §6 inteiro em 10 migrations + seed; gate verde no Supabase local.
  Decisões: **enums via CHECK** (não tipos nativos) p/ evoluir por migration; **`prevent_mutation()`**
  para append-only (RLS não basta pois `service_role` tem BYPASSRLS); **`revoke ... from anon/
  authenticated` + alter default privileges** para o anon falhar com `permission denied` (não só RLS
  vazia); colunas de scaffolding adicionadas além da §6 (`id/created_at/updated_at/client_id`,
  `claimed_by/claimed_at` em jobs/watches) — a §6 lista colunas-chave, "o DDL exato é a migration".
  `supabase init` rodado (config.toml, project_id=CroKoAI, `[db.seed]`→`./seed.sql`). Validação:
  `supabase start` (não `db reset --local`, que exige stack já no ar) → `psql` **dentro do container**
  `supabase_db_CroKoAI` (não há `psql` no PATH do host).
- **Wave 1 remote (2026-06-23):** schema aplicado ao projeto remoto **CrokoAI**
  (`smixacjjoaniaxrjcreq`) via **MCP Supabase** (`apply_migration` × 10 + seed via `execute_sql`).
  Decisões: **re-stampar `supabase_migrations.schema_migrations`** para as versões dos arquivos
  locais (o MCP gera timestamp próprio → re-stamp evita drift no `supabase db push`); **seed via
  `execute_sql`** (dado, não migration — espelha o `[db.seed]` local); **nova migration
  `harden_function_search_path`** fixando `search_path=''` nas 2 funções de trigger (fecha o advisor
  0011). Achado: event trigger `ensure_rls`/`rls_auto_enable()` pré-existente (ver §4, decisão
  pendente). Gate remoto verde.
- **Build paralelo (2026-06-23, via workflow de 11 agentes):** análise de dependências (SPEC §9)
  → 3 frentes independentes da W1 (A: 2→3→4→5 · B: 6→7 · C: 8→{9,10}); raízes paralelizáveis
  W2/W6/W8. Decisão da usuária (Opção A): paralelizar o que fecha **offline** — specs+ADRs de todas
  as ondas + scaffolds sem credencial. **Entregue:** specs `draft` + ADRs `proposed` das ondas
  2/3/4/6/7/8/9/10; pacote `@template/lp-render` (W8, 45 testes), scaffold `web/` (W6, Next 15 +
  Hono + auth + CSP, 16 testes), `@template/skill-kit` + skill/subagents (W2, 75 testes) — todos
  com build/test verdes offline. **Monorepo:** habilitados `workspaces` (`web`, `packages/*`); gate
  raiz faz fan-out (`--workspaces --if-present`); `eslint`/`vitest` raiz ignoram os workspaces (cada
  um tem gate próprio). Gate global verde: typecheck ✓ · lint ✓ · test ✓ (136 testes). **Visual:**
  identidade Croko plugada como tema default em `web/` (Tailwind 4 `@theme` re-tingindo a escala
  zinc p/ ink/paper + Fontshare Clash Display/Satoshi + `.dark` por classe) e em `lp-render`
  (`DEFAULT_THEME`); só camada visual — placeholders textuais mantidos (ver §2.1 exceção).
  **Não marcado ✅:** gates de operação real dependem de credenciais (§7). W2/W6/W8 = 🟡.
- **Build paralelo — 2ª leva (2026-06-23, 3 worktrees + agents em background):** decisão da usuária —
  paralelizar a **implementação offline** em 3 frentes disjuntas em filesystem (sem conflito de
  worktree), gate = lint/typecheck/test com mocks (e2e adiado p/ credenciais). **Frente A** (W2/3/4):
  `orchestrate-traffic.ts` + `ports.ts` (Meta/scrape/copy/image/persistência atrás de portas
  injetáveis; PAUSED/clamp/destination_type/advantage+/imagem-inline/8 operation_logs enforçados),
  infra runner (`Dockerfile`/`fly.toml`/`crontab`/`scripts/*` com lógica duplicada TS+Python — 16
  testes `unittest`), analytics funil read-only (`MetaReadPort` só expõe `listEntities` → mutação não
  compila). **Frente B** (W7 + fix W6): `web/lib/nexus/*` (chat-loop/tools/allowlist `SKILL_BY_SLUG`/
  confirmação 2-turnos via `action_id` single-use TTL/`JobInserter` por REST; injeção = dado), e
  **fix de segurança do login**: form degrada para `method=POST` (senha não vaza na URL) + endpoint
  aceita form-encoded. **Frente C** (W8/10): componentes React das 17 seções em
  `packages/lp-render/src/react` (fonte única reusável pelo editor da W9), `landing-pages/_template`
  (Next static export), skills create/publish atrás de ports; worker `worker/track` NO-PII
  (hash em memória, IP nunca persistido, idempotência D1 + `event_id` único). **Integração:** A por
  `ff-merge`, B e C por `cherry-pick` (worktrees nasceram de base antiga `390d4ae`, anterior aos
  scaffolds W6/W8 — A/C fizeram `ff` p/ `main` e B re-importou `web/`; cherry-pick descartou o
  re-import redundante). **2 commits de integração:** remoção de import morto (`buildOperationLog`) e
  `build:libs` (buildar `lp-render` antes de typecheck/test — `_template` consome subpaths `./react`/
  `./skills` compilados e `dist/` é gitignored). Gate global verde: lint ✓ · typecheck ✓ · test ✓
  (web 57 · lp-render 70 · skill-kit 136 · landing-template 2 · worker 45). **Não marcado ✅.**
