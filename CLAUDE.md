# CLAUDE.md — Convenções do projeto (SPEC-000)

> Regras específicas deste repositório. Para detalhe arquitetural completo, ver
> [`SPEC-000-build-from-scratch.md`](./SPEC-000-build-from-scratch.md) e o roadmap em
> [`WAVES.md`](./WAVES.md). Regras transversais detalhadas em `.claude/rules/`.

## O que é este projeto

Agência de tráfego Meta Ads **100% operada por IAs**, com 3 planos decoplados que se comunicam
**apenas via banco** (Supabase): Dashboard (Vercel/Next.js) · Runner headless (Fly.io) · Postgres.
**Nenhum webhook/chamada inbound entre planos** — o dashboard enfileira jobs em `agent_jobs`, o
runner faz polling, executa e escreve o resultado.

## Modo de trabalho: spec-driven em ondas

- Trabalhe **uma onda por vez** (ver `WAVES.md`). Só avance quando o **gate de aceite** passar.
- **Spec/ADR primeiro:** antes de codar uma feature, escreva/atualize `docs/specs/<feature>.md`;
  decisão estrutural → ADR em `docs/adr/` (formato Nygard).
- **Commit atômico por onda** (Conventional Commits), ex.: `feat: wave 1 supabase schema [SPEC-000]`.
- Ao concluir a onda, marque ✅ em `WAVES.md`.

## Stack (SPEC-000 §4)

TypeScript 5.6 + Node 22 · Next.js 15 (App Router) + Hono · React 19 + Tailwind 4 + shadcn/ui ·
Supabase Postgres 16 (RLS deny-by-default) · Upstash Redis · fila por polling em `agent_jobs` ·
supercronic no runner · Anthropic SDK + Claude Code CLI + OpenAI (gpt-image/Whisper) + ElevenLabs.

## Requisitos transversais (valem em TODA onda — ver `.claude/rules/`)

- **Segurança:** auth → authz → validação → lógica; validação por schema tipado (Zod) em toda
  fronteira; RLS deny-by-default; least privilege; **segredos fora do código**; headers de
  segurança em todas as respostas; rate limit em endpoints públicos; threat model STRIDE por
  superfície nova. → `.claude/rules/security.md`
- **Testes:** pirâmide (muito unit, médio integração, pouco e2e); `domain/` e `application/`
  testados; bug fix começa por teste que reproduz. → `.claude/rules/testing.md`
- **Qualidade:** TS estrito sem `any` injustificado; **código em inglês**; separation of concerns;
  edits mínimos. → `.claude/rules/code-style.md`
- **Observabilidade:** logs estruturados **sem PII**; correlation/run ids (`agent_events.run_id`).

## Contratos críticos (SPEC-000 §6/§10)

- **Dinheiro** sempre em **inteiro de centavos**. IDs externos da Meta em `text`. Todo upsert
  guarda o payload cru em `raw_spec jsonb`. Logs/eventos são **append-only** (nunca UPDATE).
- **Skills:** headless-safe (sem `AskUserQuestion`), `--dangerously-skip-permissions`,
  persistência via **REST + `SUPABASE_SECRET_KEY`** (NÃO MCP do Supabase), manifest JSON,
  `operation_logs` por mutação, idempotência.
- **Meta (gotchas):** campanha **sempre nasce PAUSED**; imagem inline em `link_data.picture`; em
  `OUTCOME_SALES` **omitir `destination_type`**; Advantage+ omite placements; a Meta busca a
  imagem do criativo no bucket **público** `ad-ingest`. Meta **só** via MCP `mcp-meta-ads`.
- **Nexus:** tools de escrita **só enfileiram** `agent_jobs`, com **confirmação em dois turnos**;
  nome de skill resolvido por **allowlist server-side por slug** (nunca texto livre).

## Placeholders do template (NÃO substituir nesta fase)

Cliente `cliente-exemplo` · produtos `curso-exemplo`/`workshop-exemplo` · assistente **Nexus** ·
agência **Acme** · domínio **example.com** · npm scope **@template** · app Fly **meta-ads-agents**.

## Comandos

- `npm run lint` · `npm run typecheck` · `npm test` — gate de qualidade.
- `npm run format:fix` — formatar com Prettier.
- (Onda 1+) `supabase db reset` — aplicar migrations + seed.
