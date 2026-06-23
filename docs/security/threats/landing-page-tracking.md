# Threat model (STRIDE) — `track.example.com` (Onda 10)

- **Superfície:** Cloudflare Worker `worker/track/`, endpoint público `POST /e`.
- **Spec/ADR:** [SPEC-015](../../specs/SPEC-015-tracking.md) · [ADR 0021](../../adr/0021-tracking-server-side.md)
- **Fonte:** SPEC-000 §11 (STRIDE por superfície nova) · `.claude/rules/security.md`

## Ativos

- Eventos de conversão das LPs (marketing, sem valor financeiro real).
- Espelho NO-PII em `lp_events` (alimenta dashboard e funil — ADR 0025).
- Segredos: `SUPABASE_SECRET_KEY`, `META_CAPI_TOKEN`, `GA4_API_SECRET`,
  `GADS_DEVELOPER_TOKEN` (Wrangler secrets).
- PII transitória (email/telefone) — só hasheada em memória, nunca persistida.

## Fronteira / fluxo

Browser da LP → `POST /e` → **origem → validação Zod → rate limit → dedup →
derivação NO-PII → fan-out (CAPI/GA4/Ads) → INSERT `lp_events`**. Sem chamada
inbound a dashboard/runner (SPEC-000 §3): o Worker só escreve no banco.

## STRIDE

| Categoria | Ameaça | Mitigação | Onde |
|---|---|---|---|
| **S**poofing | Forjar origem para injetar eventos cross-site | Allowlist por sufixo `*.example.com`; `Origin` validado server-side; `Access-Control-Allow-Origin` fixado na origem (nunca `*`). | `src/cors.ts`, `src/handler.ts` |
| **T**ampering | Forjar `value_cents`/`event_type` p/ inflar ROAS | Zod `.strict()` (rejeita campos extras, float, negativo, enum fora); valores são marketing, sem efeito de cobrança. | `src/schema.ts` |
| **R**epudiation | Evento sem rastro | `lp_events` append-only com `event_id`+`landing_page_id`; logs estruturados NO-PII no Worker. | `src/lp-events-sink.ts`, `src/destinations.ts` |
| **I**nfo disclosure | Vazar PII (email/tel/IP) por banco, log ou resposta | PII só hasheada (SHA-256, normalizada) em memória e descartada; `lp_events` NO-PII por construção; IP nunca persistido (só hash p/ rate key); respostas não ecoam o corpo. | `src/derive.ts`, `src/rate-limit.ts`, `src/handler.ts` |
| **D**oS | Flood do `/e` | Rate limit por IP hasheado (D1) + `429`/`Retry-After`; edge da Cloudflare absorve volume; fan-out deferido (`waitUntil`) com falha isolada. | `src/rate-limit.ts`, `src/d1-store.ts` |
| **E**levation | Abusar do Worker p/ escrever fora de `lp_events` | `SUPABASE_SECRET_KEY` só usado no caminho de INSERT em `lp_events`; sem endpoint administrativo; RLS deny-by-default no banco; segredos isolados no Wrangler. | `src/index.ts`, `src/lp-events-sink.ts` |

## Riscos residuais / follow-ups

- `Origin` é falsificável fora do browser; mitigado por rate limit + ausência de
  efeito financeiro. Reforço futuro: token assinado por LP (cofre RLS-locked).
- D1 é eventualmente consistente: dedup de borda é best-effort; a unicidade de
  `event_id` em `lp_events` é a garantia definitiva.
- Segredos globais nesta onda; segredos **por LP** num cofre RLS-locked ficam
  para fase posterior (SPEC-015 §Riscos residuais).
- **e2e real** (`wrangler dev` + Supabase de teste) pendente de credenciais
  Cloudflare/Supabase — ver `worker/track/README.md`.
