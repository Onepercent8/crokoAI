# ADR 0002 — Persistência no Supabase

- **Status:** accepted
- **Data:** 2026-06-22
- **Onda:** 1

## Contexto

O sistema tem 3 planos de execução decoplados (Dashboard Vercel, Runner Fly.io, e o banco) que se
comunicam **apenas via banco** — sem webhooks nem chamadas inbound entre planos (SPEC-000 §3).
Precisamos de um Postgres gerenciado com: RLS forte (multi-superfície: browser, runner headless,
RPCs), Storage para criativos/assets, e uma connection string estável para migrations versionadas.
Alternativas consideradas: Postgres puro (Neon/RDS) sem Storage/RLS integrados; Firebase (modelo
de dados não-relacional, ruim para a hierarquia Meta).

## Decisão

Vamos usar **Supabase Postgres 16** como única fonte de persistência. O schema é versionado em
`supabase/migrations/*.sql` (fonte da verdade), aplicado por `supabase db reset`. **RLS
deny-by-default em todas as tabelas** (sem policies; só `service_role` acessa). O Storage do
Supabase guarda criativos/assets/prints. A comunicação entre planos é a tabela-fila `agent_jobs`
(ver [ADR 0009](0009-fila-agent-jobs.md)).

Acesso por plano:
- **Runner headless / skills:** REST + `SUPABASE_SECRET_KEY` (NÃO o MCP do Supabase — SPEC-000 §10).
- **Dashboard:** leituras **server-side** via `service_role` (RLS fechada ao browser).
- **Dev/migrations:** Supabase CLI (`supabase db reset`) + `DATABASE_URL`; o MCP do Supabase é
  usado só em contexto interativo de desenvolvimento, nunca no caminho headless.

## Consequências

- **+** RLS deny-by-default elimina exposição acidental de tabela ao browser por padrão.
- **+** Migrations versionadas = ambiente reprodutível (`db reset` recria tudo do zero).
- **+** Storage e Postgres no mesmo provedor simplificam o fluxo de criativos (bucket `ad-ingest`).
- **−** `service_role` tem `BYPASSRLS`: invariantes como append-only **não** podem depender de RLS;
  precisam de trigger (`prevent_mutation()`).
- **−** Acoplamento ao Supabase (mitigado por ser Postgres padrão + SQL puro nas migrations).
