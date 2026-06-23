# SPEC-014 — Live review (captura visual + opinião da landing page)

- **Status:** draft
- **Onda:** 9
- **ADRs relacionados:** [0020](../adr/0020-live-review.md) ·
  [0019](../adr/0019-modo-autonomo-nexus.md) · [0012](../adr/0012-landing-cloudflare-pages.md)
- **Fonte:** [`SPEC-000-build-from-scratch.md`](../../SPEC-000-build-from-scratch.md) §8 Onda 9 ·
  §6 (autônomo) · §10 · §11

## Objetivo

Dar ao Nexus a capacidade de **olhar a landing page recém-publicada e opinar** sobre ela. Durante a
fase `reviewing` do modo autônomo ([SPEC-013](./SPEC-013-autonomous-mode.md)), o runner captura um
frame visual do preview (`<subdomain>.example.com`), gera uma narração `kind=opinion` e,
opcionalmente, envia um email com o print. A maior preocupação é **segurança da captura (SSRF)**:
tirar screenshot de uma URL controlada por dado é superfície de ataque — daí o **SSRF-guard por
allowlist de sufixo `*.example.com`** (ADR 0020).

Entregáveis:
- `lib/nexus/review-frame` — captura + upload do frame (Storage privado `nexus-review`).
- `lib/nexus/live-review` — gera a opinião a partir do frame (`NEXUS_REVIEW_MODEL`).
- `scripts/screenshot-page.cjs` — Playwright headless, com **SSRF-guard `*.example.com`**.
- `scripts/send-email.cjs` — envio best-effort do resumo+print (Resend).

## Contratos

### Entradas/saídas

- **Entrada**: `landing_pages.fqdn`/`url` do preview e contexto do watch (`watch_id`, `session_id`).
- **Saída**: objeto de print no bucket privado **`nexus-review`** (`image_path`) + 1
  `nexus_narrations` `kind=opinion` (texto da opinião) + email opcional.
- **Storage**: `nexus-review` é **privado** (SPEC-000 §6); o print nunca vai a bucket público.

### SSRF-guard (núcleo da segurança, ADR 0020)

`scripts/screenshot-page.cjs` valida a URL **antes** de navegar:

```js
// scripts/screenshot-page.cjs (esboço — CommonJS p/ Playwright no runner)
const ALLOWED_SUFFIX = ".example.com"; // template placeholder; trocar com o domínio real

function assertSafeUrl(raw) {
  const u = new URL(raw);                         // throws on malformed
  if (u.protocol !== "https:") throw new Error("ssrf: protocol not allowed");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("ssrf: localhost");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new Error("ssrf: literal IPv4");
  if (host.includes(":") || host === "[::1]") throw new Error("ssrf: literal IPv6");
  if (!host.endsWith(ALLOWED_SUFFIX)) throw new Error("ssrf: host outside allowlist");
  return u.toString();
}
```

Regras: só `https`; host **tem** de terminar em `*.example.com`; rejeita `localhost`, IPs literais
(IPv4/IPv6), metadata (`169.254.169.254` cai como IP literal), e qualquer host fora da allowlist.
Falha segura = **bloqueia** (nunca tenta navegar fora da allowlist).

### `review-frame` / `live-review` (esboço)

```ts
// lib/nexus/review-frame.ts
const FrameRequest = z.object({
  watchId: z.string().uuid(),
  url: z.string().url(),               // re-validated by SSRF-guard before screenshot
});
// captures via screenshot-page.cjs, uploads to private bucket "nexus-review", returns image_path.

// lib/nexus/live-review.ts
// takes the frame + page context, asks NEXUS_REVIEW_MODEL for an opinion,
// returns { text, imagePath } -> persisted as nexus_narrations(kind='opinion').
```

### `send-email.cjs` (best-effort)

Envia via Resend (`RESEND_API_KEY`, `AUTONOMOUS_FROM_EMAIL`, `AUTONOMOUS_NOTIFY_EMAIL`) o
resumo+print. **Falha vira log**, nunca propaga erro que trave o watch (ADR 0019/0020).

## Comportamento

- **Fluxo feliz**: fase `reviewing` → `review-frame` valida a URL (SSRF-guard) → Playwright captura →
  upload no `nexus-review` → `live-review` gera opinião → insere 1 `nexus_narrations` `kind=opinion`
  com `image_path` → fase avança para `notifying`.
- **URL fora da allowlist**: `assertSafeUrl` lança → captura abortada; o watch registra o bloqueio
  (`kind=system`, sem PII) e segue/encerra sem vazar rede interna (falha segura).
- **Captura falha (timeout/render)**: degrada — narra que não foi possível revisar (`kind=system`) e
  continua a máquina; não trava a fase.
- **Email falha**: log-only; a fase `notifying` segue para `done`.
- **Idempotência**: a opinião é gerada **uma vez** por publish (fase `reviewing`); reentrada do tick
  não duplica (cursores do watch — SPEC-013).
- **Conteúdo da página = dado**: o frame/scrape é entrada não confiável; tratado como dado, não
  instrução (prompt injection visual).

## Segurança

- **SSRF-guard** por allowlist de sufixo `*.example.com` (ADR 0020): bloqueia `localhost`, IPs
  literais, metadata e hosts arbitrários; só `https`. Falha segura = bloqueia.
- **Bucket privado** `nexus-review` para os prints (sem exposição pública).
- **Validação em fronteira**: `FrameRequest`/args por Zod; URL revalidada no screenshotter mesmo se
  já validada antes (defesa em profundidade).
- **Segredos** (`RESEND_API_KEY`, `NEXUS_REVIEW_MODEL`/chave do modelo) fora do código
  (`fly secrets`); nada em `NEXT_PUBLIC_*`.
- **PII**: opinião/narração/log **sem PII**; email vai só para `AUTONOMOUS_NOTIFY_EMAIL` configurado.
- **RLS deny-by-default**: persistência via `service_role` (REST + `SUPABASE_SECRET_KEY`), nunca MCP
  do Supabase em headless.
- **Threat model STRIDE** (superfície externa nova — captura de URL + email): atualizar/criar
  [`docs/security/threats/landing-page-editor.md`](../security/threats/landing-page-editor.md) e
  [`docs/security/threats/nexus-screen-vision.md`](../security/threats/nexus-screen-vision.md)
  cobrindo: **Information disclosure/SSRF** (alvo interno), **Spoofing** (origem do print),
  **Tampering** (prompt injection visual), **DoS** (captura cara/loop).

## Critérios de aceite

> Compõem o **gate da Onda 9** em [`WAVES.md`](../../WAVES.md) (suporte ao live review acionado pela
> fase `reviewing` do modo autônomo).

1. **A captura só ocorre para hosts `*.example.com`**: URL fora da allowlist (localhost, IP literal,
   metadata, domínio arbitrário, http) é **bloqueada** antes de navegar.
2. O print é gravado no bucket **privado** `nexus-review` e referenciado por `image_path`.
3. A fase `reviewing` insere **1** `nexus_narrations` `kind=opinion` (≤1 narração por tick) e avança
   para `notifying`.
4. Falha de captura ou de email **degrada para log** sem travar a máquina de fases.
5. `npm run lint && npm run typecheck && npm test` verdes.

## Testes

- **Unit (`assertSafeUrl`, sem I/O)**: aceita `https://x.example.com`; rejeita `http://`,
  `localhost`, `127.0.0.1`, `169.254.169.254`, `[::1]`, `https://evil.com`,
  `https://example.com.evil.com`.
- **Integração (I/O)**: `review-frame` captura+upload em `nexus-review`; `live-review` gera 1 opinião;
  `send-email.cjs` falha → log-only (não propaga); reentrada não duplica opinião.
- **e2e (seletivo)**: publish de LP em preview → fase `reviewing` produz opinião com print → narração
  aparece no dashboard.
