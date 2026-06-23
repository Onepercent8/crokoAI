# @template/skill-kit

Helpers puros e **headless-safe** para as skills (SPEC-000 Onda 2, ver
[`docs/specs/create-traffic-campaign.md`](../../docs/specs/create-traffic-campaign.md)).

> A Meta **nunca** é chamada por este pacote. As mutações na Meta acontecem só pelo MCP
> `mcp-meta-ads` dentro da skill. Aqui ficam apenas: persistência via Supabase REST,
> writer/idempotência de manifest, builder de `operation_logs`, validação Zod das fronteiras e
> guardas dos gotchas da Meta.

## Estrutura (separation of concerns — dependências apontam para dentro)

- `src/domain/` — lógica pura sem I/O (money em centavos, slug/allowlist, schemas Zod,
  gotchas da Meta, idempotência, modelo do manifest, `operation_logs`).
- `src/application/` — orquestração pura (resolução de orçamento com clamp, montagem das linhas de
  persistência, decisão de idempotência sobre leitores injetados).
- `src/infrastructure/` — I/O isolado: cliente PostgREST (`fetch` injetável), writer/leitor de
  manifest no disco, logger estruturado sem PII.

## Invariantes garantidas

- **Dinheiro sempre em inteiro de centavos** (`Cents`); orçamento clampado ao
  `daily_budget_cap_cents`.
- **Campanha sempre nasce `PAUSED`** (`assertCampaignSpecSafe`).
- **`OUTCOME_SALES` omite `destination_type`** (gotcha §10) — checado pelo guard e respeitado no
  builder da linha de `ad_sets`.
- **Todo upsert guarda `raw_spec`** (rejeita upsert sem ele).
- **Persistência via REST + `SUPABASE_SECRET_KEY`** (papel `service_role`); **nunca** MCP do
  Supabase em headless.
- **`operation_logs` append-only**, uma linha por mutação.
- **Allowlist server-side por slug** com charset restrito (`^[a-z0-9-]+$`).
- **Sem segredos/PII** em logs (redação defensiva) nem no manifest.

## Scripts

- `npm run build` — `tsc` (typecheck + emit em `dist/`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest (`vitest run`).

O segredo (`SUPABASE_SECRET_KEY`) vem do ambiente (`.env.local` em dev, `fly secrets` no runner) e
nunca é hardcoded. Em teste, `fetch` é injetado por um mock.
