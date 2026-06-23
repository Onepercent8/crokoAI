# ADR 0021 — Tracking server-side

- **Status:** proposed
- **Data:** 2026-06-23
- **Onda:** 10
- **Spec relacionada:** [SPEC-015 — Tracking server-side](../specs/SPEC-015-tracking.md)

## Contexto

As landing pages (Onda 8) vivem como sites estáticos no Cloudflare Pages em
`<subdomain>.example.com` e precisam reportar eventos de conversão (page view, view content,
add to cart, initiate checkout, purchase) para três destinos de marketing — Meta Conversions
API (CAPI), Google Analytics 4 (GA4) e Google Ads — além de espelhar esses eventos no Supabase
para o dashboard e a análise de funil (Onda 4 / ADR 0025).

Restrições estruturais que delimitam a decisão:

- **Sem PII no banco.** SPEC-000 §6/§11 e `.claude/rules/security.md` exigem que `lp_events`
  seja um espelho **NO-PII**: apenas flags `has_email`/`has_phone`, `utm_*`, `country`,
  `value`/`currency` e um `event_id` único. PII bruta (email, telefone) só pode existir
  transitoriamente para ser **hasheada** antes de sair para CAPI/Google.
- **Sem chamada inbound entre os 3 planos** (SPEC-000 §3). O tracking não pode chamar o
  dashboard nem o runner; só escreve no banco (única fonte da verdade).
- **Token de pixel/conversão é segredo.** Enviar CAPI/GA4/Google Ads direto do browser exporia
  access tokens e permitiria injeção de eventos forjados por qualquer cliente.
- **Latência e bloqueadores.** Tags client-side (Meta Pixel, gtag) são frequentemente bloqueadas
  por ad-blockers e ITP/cookie-restrictions, degradando a qualidade do match e do ROAS medido.

Alternativas consideradas:

1. **Tags client-side puras** (Meta Pixel + gtag no navegador). Simples, mas expõe tokens,
   sofre com ad-blockers, e enviaria PII pelo browser sem controle de hash/consent.
2. **Endpoint de tracking no dashboard (Vercel) ou no runner (Fly).** Violaria o desacoplamento
   (§3), colocaria PII transitória num plano que não deveria vê-la, e o dashboard ficaria no
   caminho crítico de cada page view (custo/escala).
3. **Cloudflare Worker dedicado** no mesmo edge das LPs, com endpoint único `/e`, que valida,
   normaliza, faz fan-out server-side com os tokens guardados como secrets, e escreve o espelho
   NO-PII no Supabase. **Escolhida.**

## Decisão

Adotamos um **Cloudflare Worker de tracking server-side** em `worker/track/`, exposto em
`track.example.com`, como **único ponto de coleta** dos eventos das landing pages.

- **Endpoint único `POST /e`** recebe o evento do browser (fetch keepalive / sendBeacon). O
  cliente nunca fala com Meta/Google diretamente.
- **Validação na fronteira:** origem confinada por sufixo de domínio (`ALLOWED_ORIGIN_SUFFIX`,
  default `.example.com`) — CORS e checagem server-side do header `Origin`; corpo validado por
  schema **Zod** antes de qualquer uso; **rate limit por IP**.
- **Fan-out server-side** para CAPI, GA4 (Measurement Protocol) e Google Ads, com os
  tokens/IDs guardados como **Wrangler secrets** (nunca no código nem expostos ao browser). PII
  recebida (email/telefone) é **normalizada e hasheada (SHA-256)** para o `user_data` do CAPI e
  **descartada** logo após; nunca é persistida.
- **Espelho NO-PII no Supabase:** o Worker escreve em `lp_events` via **REST +
  `SUPABASE_SECRET_KEY`** (não MCP; SPEC-000 §10) somente `event_id` (único, idempotente),
  `utm_*`, `country` (de `cf.country`), `value`/`currency`, e as flags `has_email`/`has_phone`.
- **Estado de borda em D1** (Cloudflare): dedup de `event_id` e buffer/contadores do rate limit,
  mantendo o caminho quente no edge sem ida-e-volta ao Postgres.
- **Idempotência por `event_id`:** o browser gera um `event_id` por evento (também usado como
  `event_id` do CAPI para deduplicação Meta entre pixel e CAPI); reentrega do mesmo `event_id` é
  no-op tanto no fan-out quanto no `lp_events`.
- **Cookies/storage com prefixo neutro `lp_*`** (sem marca), conforme SPEC-000 §8 Onda 10.
- **Segredos por LP** (tokens específicos de cada landing) ficarão num cofre RLS-locked em fase
  posterior; nesta onda o Worker usa secrets globais de ambiente.

## Consequências

- **+** Tokens de CAPI/GA4/Google Ads ficam server-side — nenhum segredo no browser; eventos
  forjados por terceiros são barrados por origem + rate limit.
- **+** `lp_events` é NO-PII por construção: a PII é hasheada/descartada antes de tocar qualquer
  storage, satisfazendo SPEC-000 §11 e o gate da Onda 10.
- **+** Resiliência a ad-blockers/ITP (coleta first-party no edge) e melhor qualidade de match.
- **+** Mantém o desacoplamento §3: o tracking só escreve no banco; não chama dashboard/runner.
- **+** Idempotência por `event_id` dedupe pixel↔CAPI e reentregas; `lp_events` não infla a
  análise de funil com duplicados.
- **−** Mais uma superfície HTTP pública a defender (CORS, rate limit, validação) — exige threat
  model STRIDE próprio (ver SPEC-015 §Segurança).
- **−** Acoplamento operacional ao Cloudflare (Worker + D1 + Wrangler); mitigado por o Worker ser
  TS isolado em `worker/track/` com contrato HTTP estável.
- **−** D1 é estado eventualmente consistente no edge: dedup é best-effort no edge, reforçado pela
  unicidade de `event_id` em `lp_events` (camada definitiva de idempotência).
