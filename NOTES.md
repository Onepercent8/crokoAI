# NOTES.md — Registro persistente de implementação (handoff entre waves)

> **Propósito.** Memória confiável do build que sobrevive a `/compact` e à troca de contexto.
> Atualize este arquivo **ao fim de cada wave** (ou ao tomar qualquer decisão relevante).
> Fontes irmãs: [`SPEC-000-build-from-scratch.md`](./SPEC-000-build-from-scratch.md) (a planta),
> [`WAVES.md`](./WAVES.md) (roadmap + status), [`CLAUDE.md`](./CLAUDE.md) (convenções).
>
> **Última atualização:** 2026-06-22 · **Wave atual:** 1 concluída ✅ → próxima é a **Wave 2**.

---

## 1. Estado atual (resumo executivo)

- **Wave 0 (Fundações) — ✅ aceita e commitada.** Monorepo, contrato de env, tooling e scaffold de
  docs prontos. Gate verde: `typecheck ✓ · lint ✓ · test ✓`.
- **Wave 1 (Camada de dados) — ✅ aceita.** 10 migrations (`supabase/migrations/2026...`), 20 tabelas
  da §6, RLS deny-by-default, triggers `set_updated_at`/`prevent_mutation`, RPCs `claim_agent_job`/
  `claim_autonomous_watch`, 4 buckets, lockdown de grants e seed `cliente-exemplo`. Gate verde via
  `scripts/verify-wave1.sql` contra **Supabase local** (Docker + CLI 2.72.7).
- **Próximo passo:** Wave 2 — Runtime de skills + 1ª skill (tráfego). Depende do banco (✅) e exige
  **MCP da Meta** (`mcp-meta-ads` / `CrokoMediaAdsMCP`) + materiais do `cliente-exemplo`.

---

## 2. Decisões confirmadas com a usuária (valem para todo o build)

1. **Manter placeholders do template** — NÃO substituir pela marca Croko ainda. Seguir fiel a:
   `cliente-exemplo`, produtos `curso-exemplo`/`workshop-exemplo`, assistente **Nexus**, agência
   **Acme**, domínio **example.com**, npm scope **@template**, app Fly **meta-ads-agents**.
   → A troca pela identidade real (Croko Media) é uma tarefa futura, pós-build.
2. **`.env.local` = template com placeholders + comentários.** Nenhum segredo real escrito por mim;
   preenchimento é manual da usuária. `.env.example` é a fonte canônica versionada.
3. **Escopo = roadmap completo das 12 waves, executando UMA wave por vez** com gate de aceite verde
   antes de avançar. Protocolo: spec/ADR → implementar → validar gate → commit atômico → marcar ✅.

---

## 3. Decisões de implementação (tomadas durante a Wave 0)

| Decisão | Por quê | Onde / impacto futuro |
|---|---|---|
| **Workspaces npm ainda NÃO habilitados** no `package.json` raiz | `web/`, `packages/*` etc. estão vazios; declarar workspace sem `package.json` quebra `npm install` | Adicionar `"workspaces"` incrementalmente quando cada pacote ganhar seu `package.json` (Waves 6/8) |
| `tsconfig.json` com `include: ["src/**/*.ts", "*.ts"]` + placeholder `src/env-contract.ts` | `tsc --noEmit` falha com "No inputs found" se não houver `.ts` | Ao crescer, cada pacote pode ter seu próprio `tsconfig` estendendo o raiz |
| `vitest.config.ts` com `passWithNoTests: true` | manter `npm test` verde antes da 1ª suíte | Remover/endurecer quando houver testes reais (regra: cobertura em `domain/`/`application/`) |
| ESLint flat config (v9) + `@typescript-eslint/no-explicit-any: 'warn'` | `any` é desencorajado mas não bloqueia o scaffold | Considerar subir para `error` no hardening (Wave 11) |
| `src/env-contract.ts` = espelho **tipado** dos nomes de env (REQUIRED/OPTIONAL) | dá input ao `tsc` e serve de fonte única dos nomes | A validação real (Zod, leitura tipada) entra em `web/lib/env.ts` na **Wave 6** |
| 18 stubs de ADR gerados (status `proposed`) | Docs as Code; reservar numeração da SPEC §13 | Preencher o ADR correspondente ao iniciar cada wave |
| `.gitignore` ignora `.env*` exceto `.env.example`; ignora `venv/`, `node_modules/`, build outputs, `tentativas-geracao-de-campanhas/`, `.claude/logs/` | segredos fora do git; artefatos de runtime das skills fora do git | — |

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

## 6. Inventário do que existe (pós-Wave 0)

```
.env.example          # contrato canônico de env (versionado)
.env.local            # valores de dev (GITIGNORED) — preencher
.gitignore
package.json          # scripts: lint/typecheck/test/format; devDeps (eslint9, tseslint8, vitest2, prettier3, ts5.6)
tsconfig.json         # strict + noUncheckedIndexedAccess + NodeNext
eslint.config.mjs     # flat config
.prettierrc.json / .prettierignore
vitest.config.ts      # passWithNoTests:true; coverage em domain/application
CLAUDE.md             # convenções do PROJETO (≠ CLAUDE.md global da usuária)
WAVES.md              # roadmap + status das 12 waves
NOTES.md              # este arquivo
src/env-contract.ts   # espelho tipado dos nomes de env
.claude/rules/{security,testing,code-style}.md
.claude/{skills,agents,hooks,materiais-das-empresas}/   # vazios (.gitkeep)
docs/README.md + docs/{adr,specs,how-to,reference,tutorials,explanation,security/threats,templates,sessions}/
  docs/templates/{adr-template,spec-template}.md
  docs/adr/README.md + 18 stubs (0001..0025, status proposed)
  docs/specs/README.md (índice das 11 specs por wave)
web/ packages/lp-render/ landing-pages/_template/ worker/track/ scripts/ supabase/migrations/  # vazios (.gitkeep)
```

> **NÃO confundir:** `CLAUDE.md` (raiz do repo, deste projeto) vs `~/.claude/CLAUDE.md` (global da
> usuária, Synkra AIOS) — o global permanece intocado.

---

## 7. Pendências / inputs necessários antes da próxima wave

- [x] ~~Wave 1: Supabase + CLI~~ — **resolvido via Supabase local** (Docker + CLI 2.72.7).
      Stack local no ar: Studio `http://127.0.0.1:54323`, DB `:54322`. Para subir de novo:
      `supabase start`; reset limpo: `supabase db reset` (com stack no ar).
- [ ] **`.env.local`:** colar as credenciais **locais** do bloco Supabase (impressas pelo
      `supabase start`; também na §1 da minha resposta da Wave 1). São locais-only, não-produção.
      Para **produção**, criar projeto Supabase remoto e preencher com os valores reais.
- [ ] **Wave 2 precisa:** MCP da Meta (`CrokoMediaAdsMCP`/`mcp-meta-ads`) autenticado +
      `materiais-das-empresas/cliente-exemplo/` (logo, fotos, brief de produto) para a 1ª skill.
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
- _(próximas waves: adicionar uma entrada aqui ao concluir cada uma)_
