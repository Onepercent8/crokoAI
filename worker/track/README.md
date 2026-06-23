# `worker/track` — Tracking server-side (SPEC-015, Onda 10)

Cloudflare Worker que coleta eventos de conversão das landing pages num único
endpoint `POST /e`, faz fan-out server-side (Meta CAPI / GA4 / Google Ads) e
espelha cada evento em `lp_events` **sem PII**.

## Arquitetura (offline-first, fronteiras injetáveis)

A lógica vive em funções/classes puras, com toda fronteira externa atrás de
interface (`src/ports.ts`), mockada nos testes:

- `src/schema.ts` — schema Zod do evento (`.strict()`; dinheiro em centavos).
- `src/cors.ts` — allowlist de origem por sufixo + headers de segurança.
- `src/rate-limit.ts` — rate limit por IP **hasheado** (IP cru nunca persistido).
- `src/derive.ts` — derivação NO-PII (`lp_events`) + hash SHA-256 de email/telefone
  (só em memória, descartado após o fan-out).
- `src/destinations.ts` — adaptadores CAPI/GA4/Google Ads + `fanOut` (falha isolada).
- `src/lp-events-sink.ts` — escrita REST + `SUPABASE_SECRET_KEY` (`ignore-duplicates`).
- `src/d1-store.ts` — estado de borda (dedup `event_id` + contadores de rate) em D1.
- `src/handler.ts` — orquestra a ordem obrigatória **origem → validação → rate
  limit → dedup → derivação → fan-out → espelho → resposta**. Puro/testável.
- `src/index.ts` — entrypoint do Worker: liga os bindings reais ao handler.

## Ordem do handler (`.claude/rules/security.md`)

origem/CORS → validação Zod → rate limit → dedup → derivação NO-PII → fan-out
(deferido, best-effort) → INSERT em `lp_events` → resposta `202`. A resposta
nunca ecoa o corpo nem devolve PII.

## Gate offline

```
npm run typecheck -w @template/track-worker
npm test -w @template/track-worker
```

Cobre: validação (PII malformada, float/negativo, enum, campos extras),
decisão de origem (apex/subdomínio/lookalike), rate limit + `Retry-After`,
idempotência por `event_id`, shape NO-PII de `lp_events`, isolamento de falha
de destino, e escrita REST com `ignore-duplicates`.

## Deploy (gated por credenciais Cloudflare — pendente)

1. Criar a base D1 e aplicar a migration:
   ```
   wrangler d1 create template-track
   # colar o database_id no wrangler.toml
   wrangler d1 migrations apply template-track
   ```
2. Definir os segredos (NUNCA no `wrangler.toml`):
   ```
   wrangler secret put SUPABASE_SECRET_KEY
   wrangler secret put META_CAPI_TOKEN
   wrangler secret put GA4_API_SECRET
   wrangler secret put GADS_DEVELOPER_TOKEN
   ```
3. Ajustar `vars` (SUPABASE_URL, *_ID, ALLOWED_ORIGIN_SUFFIX) e a `route`
   (`track.example.com`) no `wrangler.toml`.
4. `wrangler deploy`.

**e2e (pendente de credencial):** `POST /e` contra `wrangler dev` verificando
`202`, linha NO-PII no Supabase de teste e idempotência por `event_id`.
Threat model STRIDE da superfície: ver `docs/security/threats/landing-page-tracking.md`.
