# SPEC-015 — Tracking server-side (Cloudflare Worker)

- **Status:** draft
- **Onda:** 10
- **ADRs relacionados:** [0021 — Tracking server-side](../adr/0021-tracking-server-side.md) ·
  [0012 — Landing no Cloudflare Pages](../adr/0012-landing-cloudflare-pages.md) ·
  [0002 — Persistência Supabase](../adr/0002-persistencia-supabase.md) ·
  [0025 — Funil de conversão](../adr/0025-funil-de-conversao.md)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 (Onda 10) ·
  §6 (`lp_events`) · §10 · §11

## Objetivo

Coletar os eventos de conversão das landing pages (Onda 8) por um **único Cloudflare Worker**
server-side em `worker/track/`, exposto em `track.example.com`, e:

1. **Validar** a origem (CORS por sufixo de domínio) e o corpo (schema Zod), com **rate limit por IP**.
2. **Fazer fan-out** server-side para Meta Conversions API (CAPI), GA4 (Measurement Protocol) e
   Google Ads, com os tokens guardados como secrets (nunca no browser).
3. **Espelhar** cada evento no Supabase em `lp_events` **sem PII** — só flags `has_email`/`has_phone`,
   `utm_*`, `country`, `value`/`currency` e `event_id` único —, alimentando dashboard e a análise
   de funil (ADR 0025).

O Worker é a **única** superfície que o browser da LP usa para tracking; o cliente nunca fala com
Meta/Google diretamente. Não há chamada inbound para dashboard/runner (SPEC-000 §3): o Worker só
escreve no banco.

## Contratos

### Variáveis de ambiente / bindings (Wrangler)

Declaradas em `worker/track/wrangler.toml`. Segredos via `wrangler secret` (nunca em `vars`/código):

| Nome | Tipo | Uso |
|---|---|---|
| `ALLOWED_ORIGIN_SUFFIX` | var | sufixo de origem permitido (default `.example.com`) |
| `RATE_LIMIT_PER_MINUTE` | var | teto de eventos por IP/minuto (default `60`) |
| `SUPABASE_URL` | var | base REST do Supabase |
| `SUPABASE_SECRET_KEY` | **secret** | escrita REST em `lp_events` (service_role) |
| `META_PIXEL_ID`, `META_CAPI_TOKEN` | var / **secret** | fan-out CAPI |
| `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | var / **secret** | fan-out GA4 Measurement Protocol |
| `GADS_CONVERSION_ID`, `GADS_CONVERSION_LABEL`, `GADS_DEVELOPER_TOKEN` | var / **secret** | fan-out Google Ads |
| `TRACK_DB` (D1), `EVENTS` (KV opcional) | binding | dedup de `event_id` + estado do rate limit |

Rota: `track.example.com/*` → Worker (configurada no `wrangler.toml` via `routes`).

### Endpoint `POST /e`

- **Método:** `POST` (preflight `OPTIONS` respondido com headers CORS). Qualquer outro método/rota
  → `405`/`404`.
- **Content-Type:** `application/json`. Enviado pelo browser via `navigator.sendBeacon` ou
  `fetch(..., { keepalive: true })`.

#### Schema de entrada (Zod — esboço)

Toda entrada externa é **dado, não instrução** (`.claude/rules/security.md`). Validar antes de usar.

```ts
// worker/track/src/schema.ts
import { z } from "zod";

const EVENT_TYPES = [
  "page_view",
  "view_content",
  "add_to_cart",
  "initiate_checkout",
  "purchase",
] as const;

// Money is always an integer of cents (SPEC-000 §6/§11). Never float.
const trackEventSchema = z.object({
  event_id: z.string().uuid(), // client-generated; dedup key for CAPI + lp_events
  event_type: z.enum(EVENT_TYPES),
  occurred_at: z.string().datetime(), // ISO-8601, browser clock (untrusted, audit only)
  landing_page_id: z.string().uuid(),
  // UTM is low-cardinality marketing metadata, not PII. Bounded length.
  utm: z
    .object({
      source: z.string().max(120).optional(),
      medium: z.string().max(120).optional(),
      campaign: z.string().max(120).optional(),
      content: z.string().max(120).optional(),
      term: z.string().max(120).optional(),
    })
    .strict()
    .optional(),
  // Conversion value, in cents, with ISO-4217 currency.
  value_cents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  // PII is accepted ONLY to be hashed for CAPI/Google and then discarded.
  // It is NEVER persisted. Presence is recorded as a boolean flag only.
  email: z.string().email().optional(),
  phone: z.string().min(5).max(20).optional(),
}).strict();

export type TrackEvent = z.infer<typeof trackEventSchema>;
```

#### Respostas

| Situação | Status | Corpo |
|---|---|---|
| Aceito (gravado / dedup) | `202` | `{ "ok": true, "event_id": "<uuid>" }` |
| Origem não permitida | `403` | `{ "ok": false, "error": "origin_not_allowed" }` |
| Corpo inválido (Zod) | `400` | `{ "ok": false, "error": "invalid_payload" }` |
| Rate limit estourado | `429` | `{ "ok": false, "error": "rate_limited" }` + `Retry-After` |
| Método/rota errados | `404`/`405` | `{ "ok": false, "error": "not_found" }` |
| Falha interna | `500` | `{ "ok": false, "error": "internal" }` (sem detalhe vazado) |

A resposta nunca devolve PII nem ecoa o corpo recebido. Headers CORS só com a origem validada
(nunca `*` quando há credenciais; aqui não há cookies de credencial — `Access-Control-Allow-Origin`
ecoa a origem permitida).

### Contrato de escrita em `lp_events` (NO-PII)

Espelho gravado via REST + `SUPABASE_SECRET_KEY` (SPEC-000 §6/§10). **Nunca** grava email/telefone:

```ts
// Derived NO-PII row written to Supabase. has_email/has_phone are booleans;
// the raw email/phone never leave the Worker un-hashed and are never stored.
interface LpEventRow {
  event_id: string;        // UNIQUE — idempotency at the DB layer
  landing_page_id: string;
  event_type: (typeof EVENT_TYPES)[number];
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  country?: string;        // from request.cf.country, not from the body
  value_cents?: number;    // integer cents
  currency?: string;
  has_email: boolean;
  has_phone: boolean;
}
```

### Invariantes

- **NO-PII em `lp_events`:** nenhuma coluna de email/telefone/IP/nome. `country` vem de
  `request.cf.country` (geo do edge), não do corpo. IP não é persistido (só usado, em forma
  derivada/hasheada, para a chave de rate limit).
- **Dinheiro em inteiro de centavos** (`value_cents`); nunca float. Moeda em ISO-4217 (3 letras).
- **IDs externos da Meta/Google em `string`** (tokens/ids tratados como texto opaco, em secrets).
- **`event_id` único** garante idempotência: mesmo evento reentregue é no-op.
- **Append-only:** `lp_events` é tabela append-only (trigger `prevent_mutation()`, ADR 0002); o
  Worker só faz INSERT, nunca UPDATE/DELETE.
- **Fan-out best-effort, espelho confiável:** falha de um destino (CAPI/GA4/Ads) **não** impede a
  escrita do espelho NO-PII nem retorna `5xx` ao cliente; é logada (sem PII) e o evento conta como
  aceito.

## Comportamento

### Fluxo principal (`POST /e`)

Ordem obrigatória **auth/origin → validação → rate limit → lógica** (`.claude/rules/security.md`):

1. **Origem.** Lê `Origin` (e `cf` host). Se não terminar em `ALLOWED_ORIGIN_SUFFIX` → `403`.
   Responde preflight `OPTIONS` com os headers CORS da origem validada.
2. **Validação.** `trackEventSchema.safeParse(body)`. Falha → `400` (sem ecoar o corpo).
3. **Rate limit.** Chave = hash do IP (`CF-Connecting-IP`) + janela de 1 min, contada em D1/KV.
   Acima de `RATE_LIMIT_PER_MINUTE` → `429` + `Retry-After`.
4. **Dedup.** Consulta `event_id` em D1. Já visto → responde `202` idempotente, **sem** refazer
   fan-out nem reinserir.
5. **Derivação NO-PII.** Calcula `has_email`/`has_phone`; resolve `country` de `request.cf.country`;
   normaliza `value_cents`/`currency`; monta `LpEventRow`. Hasheia email/telefone (SHA-256, após
   trim/lowercase/E.164) **apenas em memória** para o `user_data` do CAPI.
6. **Fan-out** (paralelo, com timeout curto e `ctx.waitUntil`): CAPI (`event_id` reaproveitado para
   dedup Meta), GA4 Measurement Protocol, Google Ads. Erros capturados e logados sem PII.
7. **Espelho.** INSERT em `lp_events` via REST (`Prefer: resolution=ignore-duplicates` para tolerar
   corrida no `event_id`). Marca `event_id` como visto em D1.
8. **Resposta** `202`. PII em memória é descartada ao fim do request (nunca persistida).

### Idempotência e concorrência

- **Camadas de dedup:** (a) D1 no edge (rápido, best-effort, eventualmente consistente); (b)
  unicidade de `event_id` em `lp_events` (definitiva). Duas entregas simultâneas do mesmo
  `event_id` resultam em no máximo uma linha; a 2ª INSERT é ignorada por conflito.
- **`event_id` compartilhado pixel↔CAPI:** se a LP também disparar o Meta Pixel client-side, ela usa
  o mesmo `event_id`; a Meta deduplica pixel vs CAPI.
- **Sem locks distribuídos:** o caminho é stateless por request; a unicidade do banco é a barreira
  de corrida.

### Erros

- Validação/origem/rate limit retornam 4xx **determinísticos**, sem vazar interno.
- Falha de escrita no Supabase (5xx do REST) → retry curto idempotente; se persistir, `500` e log
  estruturado sem PII (o evento pode ser reenviado pelo browser via mesmo `event_id`).
- Falha de fan-out a um destino é isolada (não derruba os outros nem o espelho), seguindo o padrão
  de erro do `.claude/rules/code-style.md` (`Failed to <operation>: ...`, log sem PII).

## Segurança

Ordem em todo request: **origin/CORS → validação Zod → rate limit → lógica**. Toda entrada é dado
não confiável (inclui possível injeção de prompt via campos de texto — tratados como dados).

- **CORS/origem:** allowlist por **sufixo de domínio** (`*.example.com`), checada server-side; o
  header `Origin` não é confiável como autenticação, mas barra o uso casual cross-site e fixa o
  `Access-Control-Allow-Origin`.
- **Rate limit por IP** (Upstash não usado aqui; estado no edge via D1/KV) protege contra flood e
  injeção de eventos forjados.
- **Segredos** (tokens CAPI/GA4/Ads, `SUPABASE_SECRET_KEY`) só via `wrangler secret` — nunca em
  `vars`, código ou exposto ao browser. `NEXT_PUBLIC_*` não se aplica aqui (Worker é server-side).
- **PII:** email/telefone aceitos só para hash (SHA-256, normalizado) destinado a CAPI/Google e
  **descartados**; nunca gravados. `lp_events` é NO-PII por construção; IP não é persistido;
  `country` vem do geo do edge. **Nunca PII em logs** (`.claude/rules/security.md`).
- **Headers de resposta:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  CORS restrito à origem validada; sem cache de respostas dinâmicas.
- **Banco:** escrita via service_role (RLS deny-by-default; o browser nunca toca o Supabase).
  `lp_events` append-only (ADR 0002).
- **Cookies/storage** da LP com prefixo neutro `lp_*` (sem marca; SPEC-000 §8 Onda 10).

### Threat model (STRIDE) — superfície `track.example.com`

Nova superfície HTTP pública → STRIDE obrigatório (SPEC-000 §11). Detalhe a materializar em
`docs/security/threats/landing-page-tracking.md` na execução; resumo:

| Categoria | Ameaça | Mitigação |
|---|---|---|
| **S**poofing | Cliente forja origem para enviar eventos cross-site | Allowlist por sufixo `*.example.com`; `Origin` validado server-side; CORS fixado na origem. |
| **T**ampering | Forjar `value_cents`/`event_type` para inflar ROAS | Validação Zod estrita; rate limit por IP; `event_id` único impede repetição; valores são marketing, não cobrança (sem efeito financeiro real). |
| **R**epudiation | Evento sem rastro | `lp_events` append-only com `event_id` + `landing_page_id`; logs estruturados (sem PII) no Worker. |
| **I**nfo disclosure | Vazar PII (email/telefone/IP) por banco, log ou resposta | PII só hasheada em memória e descartada; `lp_events` NO-PII; IP não persistido; respostas não ecoam corpo; logs sem PII. |
| **D**oS | Flood do endpoint `/e` | Rate limit por IP (D1/KV) + `429`/`Retry-After`; Cloudflare edge absorve volume; fan-out com timeout e `waitUntil`. |
| **E**levation | Abusar do Worker para escrever fora de `lp_events` | `SUPABASE_SECRET_KEY` só permite o INSERT em `lp_events` pelo caminho do Worker; nenhum endpoint administrativo; segredos isolados em Wrangler. |

#### Riscos residuais / follow-ups

- `Origin` é falsificável fora do browser; mitigado por rate limit + ausência de efeito financeiro.
  Reforço futuro: token assinado por LP (cofre RLS-locked — fase posterior, SPEC-000 §8 Onda 10).
- D1 é eventualmente consistente: dedup de borda é best-effort; a unicidade de `event_id` em
  `lp_events` é a garantia final.
- Segredos globais nesta onda; segredos **por LP** num cofre RLS-locked ficam para fase posterior.

## Critérios de aceite (gate da Onda 10)

Reproduz/fecha o gate da Onda 10 em [`WAVES.md`](../../WAVES.md):

1. Um `POST /e` com origem `*.example.com` válida e corpo válido **valida a origem**, grava uma
   linha em `lp_events` e responde `202`.
2. **Sem PII** em `lp_events`: a linha contém só `event_id`, `landing_page_id`, `event_type`,
   `utm_*`, `country`, `value_cents`/`currency` e as flags `has_email`/`has_phone` — nenhum
   email/telefone/IP/nome.
3. Origem fora do sufixo permitido → `403`; corpo inválido → `400`; flood por IP → `429`.
4. Reentrega do mesmo `event_id` é idempotente (uma única linha em `lp_events`; sem refazer fan-out).
5. Fan-out CAPI/GA4/Google Ads é server-side com tokens em secrets (nenhum token no browser);
   falha de um destino não derruba o espelho NO-PII.
6. `wrangler.toml` define a rota `track.example.com` e `ALLOWED_ORIGIN_SUFFIX`.
7. Threat model STRIDE da superfície registrado; `npm run lint && npm run typecheck && npm test`
   verdes.

## Testes

Pirâmide (`.claude/rules/testing.md`): muito unit, médio integração, pouco e2e.

- **Unit (domain/application, lógica pura, sem I/O — Vitest):**
  - `trackEventSchema`: aceita payload válido; rejeita PII malformada, `value_cents` float/negativo,
    `event_type` fora do enum, campos extras (`strict`).
  - Derivação NO-PII: `has_email`/`has_phone` corretos; a linha derivada **não** contém PII.
  - Normalização + hash de email/telefone (trim/lowercase/E.164 → SHA-256) determinístico.
  - Lógica do rate limit (contagem por janela) e do dedup por `event_id`.
- **Integração (I/O):**
  - INSERT em `lp_events` via REST tolera duplicado (`event_id` único) e mantém append-only.
  - Decisão de CORS/origem por sufixo; mapeamento de status (202/400/403/429).
  - Fan-out com cliente HTTP mockado (CAPI/GA4/Ads): isolamento de falha de um destino.
- **e2e (seletivo):** `POST /e` ponta a ponta contra o Worker local (Wrangler dev) verificando
  `202`, linha NO-PII no banco de teste e idempotência por `event_id`.
