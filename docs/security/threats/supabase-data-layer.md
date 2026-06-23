# Threat model (STRIDE) — Camada de dados Supabase

- **Onda:** 1
- **Superfície:** banco Postgres (Supabase) + Storage; acessado por runner (service_role via REST),
  dashboard (service_role server-side) e CLI de dev (`DATABASE_URL`). **Não há acesso direto do
  browser** (RLS deny-by-default + grants revogados de anon/authenticated).

## Ativos

Dados de clientes/campanhas, criativos, análises, fila `agent_jobs`, logs append-only, buckets de
storage (1 público de ingest). Segredos: `SUPABASE_SECRET_KEY`, `DATABASE_URL`.

## STRIDE

| Categoria | Ameaça | Mitigação (Onda 1) |
|---|---|---|
| **S**poofing | Cliente anônimo se passa por backend e lê tabelas | RLS habilitada sem policies + `revoke all` de anon/authenticated → acesso só com `service_role` (segredo server-side). |
| **T**ampering | Alterar/forjar logs de auditoria ou eventos | Tabelas `operation_logs`/`agent_events`/`lp_events` append-only via trigger `prevent_mutation()` (vale inclusive p/ service_role). `raw_spec` preserva payload cru. |
| **R**epudiation | Ação sem rastro | `operation_logs` por mutação + `agent_events` com `run_id`; append-only garante não-repúdio. |
| **I**nfo disclosure | Vazar PII por logs/eventos; bucket público expor dado sensível | `lp_events` **NO-PII** (só flags/utm/country/valor). Bucket público restrito a `ad-ingest` (só imagens de anúncio; nomes com componente aleatório). Demais buckets privados. |
| **D**oS | Inundar a fila `agent_jobs` | Índices únicos parciais limitam ≤1 job ativo por (client,kind)/(landing,kind); poller processa 1 job/min (Onda 3). Rate limit nas superfícies HTTP (Ondas 6/10). |
| **E**levation | anon/authenticated executar RPC de claim | `EXECUTE` revogado de public/anon/authenticated; `grant` só a `service_role`. SECURITY DEFINER com `search_path` fixo evita hijack de função. |

## Riscos residuais / follow-ups

- `service_role` tem `BYPASSRLS` — comprometer o segredo dá acesso total. Mitigar: segredo só em
  `fly secrets`/env do Vercel, nunca no código; rotação periódica (Onda 11).
- Conteúdo de `ad-ingest` é público — nunca gravar PII ali. Reforçar no code review da Onda 2.
- `search_path` das RPCs fixo em `public`; revisar se novas extensões mudarem o schema.
